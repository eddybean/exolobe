import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import type { TranscriptionPort } from '@application/ports'
import { AppError, toMessage, type ErrorReason } from '@domain/errors'
import { glossaryPrompt } from '@domain/Glossary'
import type { TranscriptSegment } from '@domain/TranscriptSegment'
import { wavDurationMs } from '@infrastructure/audio/wav'
import { collapseRepeats, dropRepeatedSegments } from './repetition'

export class TranscriptionError extends AppError {}

/** whisper-cli が `--output-json` で書き出す JSON の必要な部分だけを写した型。 */
interface WhisperJson {
  transcription?: {
    offsets?: { from?: number; to?: number }
    text?: string
    /**
     * `--output-json-full` のときだけ付く。`p` はトークンの確率。
     * `offsets` は VAD で無音を詰めたあとの時間軸のまま（元の時間軸へは戻されない）。
     */
    tokens?: WhisperToken[]
  }[]
}

interface WhisperToken {
  text?: string
  p?: number
  offsets?: { from?: number; to?: number }
}

/**
 * VAD が見つけた発話区間 1 つぶんの、元の音声の時刻と無音を詰めたあとの時刻の対応。
 * whisper-cli はこの表を JSON に書かず、ログ（stderr）にだけ出す。
 */
export interface VadSpan {
  readonly origStartMs: number
  readonly origEndMs: number
  readonly vadStartMs: number
  readonly vadEndMs: number
}

const VAD_SPAN_LINE =
  /vad_segment_info:\s*orig_start:\s*([\d.]+),\s*orig_end:\s*([\d.]+),\s*vad_start:\s*([\d.]+),\s*vad_end:\s*([\d.]+)/g

/** 秒の小数（ログは 10ms 単位）をミリ秒の整数にする。浮動小数の端数を残さない。 */
const secondsToMs = (seconds: string): number => Math.round(Number(seconds) * 1000)

/**
 * whisper-cli のログから VAD の発話区間の対応表を読む。読めなければ空。
 *
 * ログの形式は whisper.cpp の約束事ではなく、版が変われば読めなくなりうる。
 * 空のときは切り直しをせず、今までどおりの発言を返す（ADR-036）。
 */
export const parseVadSpans = (stderr: string): VadSpan[] =>
  [...stderr.matchAll(VAD_SPAN_LINE)].map(([, origStart = '', origEnd = '', vadStart = '', vadEnd = '']) => ({
    origStartMs: secondsToMs(origStart),
    origEndMs: secondsToMs(origEnd),
    vadStartMs: secondsToMs(vadStart),
    vadEndMs: secondsToMs(vadEnd)
  }))

/**
 * セグメントを捨てる平均対数確率の下限。
 *
 * whisper-cli の `--logprob-thold` の既定値と同じ -1.0 を使う。whisper.cpp は
 * この値をデコードのやり直し判断にしか使わず、確信度の低いセグメントも出力へ残す。
 * 雑音や複数人の声が重なった区間で生まれるハルシネーションはここが低いので、
 * 同じ基準で落とす。閾値を上げると本物の発話まで巻き込むため、下げる側にだけ倒す。
 */
const MIN_AVG_LOGPROB = -1

/**
 * `[_BEG_]` や `[_TT_100]` のような、発話ではない制御トークン。
 * タイムスタンプ側は `_]` で終わらないため、接頭辞だけで判定する。
 */
const SPECIAL_TOKEN = /^\[_/

/**
 * セグメントの平均対数確率。判断材料が無いときは undefined を返す。
 *
 * 「確率が無い」を「確信度が低い」と読み替えて消すと、`--output-json-full` に
 * 対応しない whisper-cli で文字起こしが丸ごと消える。
 */
export const averageLogprob = (tokens: readonly { text?: string; p?: number }[] | undefined): number | undefined => {
  const probs = (tokens ?? [])
    .filter((token) => !SPECIAL_TOKEN.test(token.text ?? ''))
    .map((token) => token.p)
    .filter((p): p is number => typeof p === 'number')

  if (probs.length === 0) return undefined

  // 確率 0 のトークンは ln(0) = -Infinity になる。平均は -Infinity のまま
  // 閾値を下回るので正しく落ちるが、NaN にはしないよう合計だけで済ませる。
  return probs.reduce((sum, p) => sum + Math.log(p), 0) / probs.length
}

/** セグメントを落とした関門。閾値を見直すには、どこで落ちたかが要る。 */
export type DropReason = 'non-speech' | 'boilerplate' | 'low-confidence' | 'repetition'

/** 落としたセグメントの記録。計測モードでのみ作られる。 */
export interface DroppedSegment {
  readonly speakerId: string
  readonly startMs: number
  readonly endMs: number
  readonly text: string
  readonly reason: DropReason
  /** 確率を持つトークンがあったときだけ入る。 */
  readonly avgLogprob?: number
}

/**
 * 落としたセグメントの通知先。
 *
 * 出力先をここで決めないのは、`console` を持たない呼び出し元（テスト、将来の
 * ファイル出力）からも同じ経路で受け取れるようにするため。
 */
export type DroppedSegmentReporter = (dropped: DroppedSegment) => void

/** `1:02:03.450` 形式。会議は 1 時間を超えるので時まで出す。 */
const formatTimestamp = (ms: number): string => {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return [
    pad(Math.floor(ms / 3_600_000)),
    pad(Math.floor(ms / 60_000) % 60),
    `${pad(Math.floor(ms / 1_000) % 60)}.${pad(ms % 1_000, 3)}`
  ].join(':')
}

/** 落としたセグメントを 1 行のログにする。 */
export const formatDroppedSegment = (dropped: DroppedSegment): string =>
  [
    `[dropped:${dropped.reason}]`,
    `${formatTimestamp(dropped.startMs)}-${formatTimestamp(dropped.endMs)}`,
    dropped.speakerId,
    ...(dropped.avgLogprob === undefined ? [] : [`logprob=${dropped.avgLogprob.toFixed(3)}`]),
    `「${dropped.text}」`
  ].join(' ')

/**
 * 落としたセグメントを計測するための環境変数。
 *
 * 設定画面に出さず環境変数にしたのは、これが閾値を見直すための一時的な計測だから。
 * 落としたセグメントには会議の本文がそのまま載るので、通常の利用では出さない。
 *
 * `OMR_LOG_DROPPED_SEGMENTS=1 npm run dev` で有効になる。パイプラインはワーカー
 * （utilityProcess）で動くが、fork 時に `process.env` を丸ごと渡しているため届く。
 */
const LOG_DROPPED_SEGMENTS = 'OMR_LOG_DROPPED_SEGMENTS'

/** 計測モードが有効なら通知先を作る。無効なら undefined（＝何も記録しない）。 */
export const droppedSegmentLogger = (
  env: Readonly<Record<string, string | undefined>>,
  write: (line: string) => void
): DroppedSegmentReporter | undefined => {
  const flag = env[LOG_DROPPED_SEGMENTS]
  if (flag === undefined || flag === '' || flag === '0') return undefined
  return (dropped) => write(formatDroppedSegment(dropped))
}

/**
 * whisper-cli の JSON 出力を TranscriptSegment へ変換する。
 *
 * whisper は無音区間で `[BLANK_AUDIO]` や `(音楽)` のようなプレースホルダを
 * 出すことがある。会議の文字起こしでは雑音になるため取り除く。
 *
 * 加えて、平均対数確率が低いセグメントも落とす。雑音や複数人の声が重なった区間で
 * whisper が作り出す文は、決まり文句の一覧では捕まえられない一方、トークンの確信度が
 * 揃って低い。要約はこの後の工程なので、ここで落としておかないと嘘が下流へ伝播する。
 *
 * 繰り返しのループは確信度が高いまま続くので、繰り返しという形で取り除く（ADR-038）。
 */
export const parseWhisperJson = (
  raw: string,
  speakerId: string,
  onDropped?: DroppedSegmentReporter,
  /** VAD の発話区間の対応表。あれば、区間をまたいだ発言を区間ごとに切り直す。 */
  vadSpans: readonly VadSpan[] = []
): TranscriptSegment[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error: unknown) {
    throw new TranscriptionError({ code: 'transcriptionOutputUnreadable' }, { cause: error })
  }

  const entries = (parsed as WhisperJson).transcription
  if (!Array.isArray(entries)) return []

  const segments = entries.flatMap((entry): TranscriptSegment[] => {
    const text = (entry.text ?? '').trim()
    if (text.length === 0) return []

    const startMs = entry.offsets?.from
    const endMs = entry.offsets?.to
    if (typeof startMs !== 'number' || typeof endMs !== 'number') return []

    const pieces = splitAtVadGaps({ startMs, endMs, text, tokens: entry.tokens ?? [] }, vadSpans)
    return pieces.flatMap((piece): TranscriptSegment[] => {
      // ループを縮めてから他の関門に掛ける。「ご視聴ありがとうございました」が
      // 繰り返されていても、縮めれば定型句として落とせる。
      const { text, removed } = collapseRepeats(piece.text)
      const segment = { startMs: piece.startMs, endMs: piece.endMs, speakerId, text }
      if (removed) onDropped?.({ ...segment, text: removed, reason: 'repetition' })

      const logprob = averageLogprob(piece.tokens)
      const reason = dropReason(text, logprob)
      if (reason === undefined) return [segment]

      onDropped?.({ ...segment, reason, ...(logprob === undefined ? {} : { avgLogprob: logprob }) })
      return []
    })
  })

  // 他の関門を通ったものだけで比べる。落とした定型句を挟んでもループは続いている。
  const { kept, dropped } = dropRepeatedSegments(segments)
  for (const segment of dropped) onDropped?.({ ...segment, reason: 'repetition' })
  return kept
}

interface SegmentPiece {
  readonly startMs: number
  readonly endMs: number
  readonly text: string
  readonly tokens: readonly WhisperToken[]
}

/**
 * 区間の境目からこの時間より離れた句読点では切らない（詰めたあとの時間軸）。
 *
 * トークンの時刻は区間の境目からずれる。実測では最大 0.5 秒ほど後ろにずれ、文末の「。」が
 * 次の区間の中に載っていた。区間どうしの隙間は 0.1〜0.2 秒しかないので、トークンの時刻だけで
 * 振り分けると語の途中（「ロ|グイン」）や句読点の前で割れる。余裕を見て倍の 1 秒まで探す。
 */
const CUT_SEARCH_MS = 1_000

/**
 * 元の時間軸でこれ以上空いた区間の境目は、近くに文末の句読点が無くても切る。
 *
 * 短い間で割れた区間は、1 つの文の息継ぎを VAD が割ったもの（実測で「インデ|ックス」の間が
 * 0.23 秒、「検索は、|インデックスの…」の間が 0.22 秒）が多く、切らずに残しても発言が
 * 数秒伸びるだけで済む。長く空いたものを残すと、無音ごと何分にも伸びるという元の不具合に戻る。
 */
const LONG_GAP_MS = 3_000

/**
 * 発言の端が区間に掛かる長さがこれに満たなければ、その区間はまたいでいないものとして扱う（元の時間軸）。
 *
 * whisper の発言の開始・終了も、トークンと同じく区間の境目からずれる。実測（公開コーパスの発話を
 * 4〜40 秒の雑音で挟んだ長尺音声）では、発言の頭やお尻が隣の区間に 10〜140ms だけ掛かり、
 * その区間との境目が長い無音なので語の途中で切られていた（「病|院の」「主張|しました。」
 * 「ジャ|ンカルド」）。掛かった分には実際の発話が載っていないので、境目ごと無かったことにする。
 * 本物の発話が 0.3 秒に満たないまま区間の端に残るのは相槌 1 つ程度で、外しても文字は隣の発言に残る。
 */
const EDGE_OVERLAP_MS = 300

const SENTENCE_END = /[。．.？?！!]$/
const CLAUSE_END = /[、，,]$/
const PUNCTUATION_ONLY = /^[\s。．.？?！!、，,…]+$/

interface TimedToken {
  readonly token: WhisperToken
  readonly text: string
  readonly from: number
  readonly to: number
}

/**
 * 区間の境目 1 つに対し、トークンの列のどこで切るか（その位置から後ろが次の発言）。
 * 切らないなら undefined。
 *
 * 文末の句読点の直後を最優先に選ぶ。長く空いた境目に限り、読点の直後、それも無ければ
 * 境目に最も近いトークンの切れ目でも切る。どれも同じ種類の中では境目に近い方。
 * 句読点の直前では切らない — 句読点が次の発言の頭に回ったり、句読点だけの発言になったりする。
 */
const cutIndexFor = (
  tokens: readonly TimedToken[],
  after: number,
  boundaryMs: number,
  longGap: boolean
): number | undefined => {
  let best: { index: number; rank: number; distance: number } | undefined
  for (let index = after + 1; index < tokens.length; index++) {
    const previous = tokens[index - 1]
    const next = tokens[index]
    if (!previous || !next || PUNCTUATION_ONLY.test(next.text)) continue

    const distance = Math.abs((previous.to + next.from) / 2 - boundaryMs)
    const rank = SENTENCE_END.test(previous.text) ? 0 : CLAUSE_END.test(previous.text) ? 1 : 2
    if (rank > 0 && !longGap) continue
    if (rank < 2 && distance > CUT_SEARCH_MS) continue
    if (!best || rank < best.rank || (rank === best.rank && distance < best.distance)) {
      best = { index, rank, distance }
    }
  }
  return best?.index
}

/**
 * VAD の発話区間をまたいだ発言を、区間ごとに切り分ける（ADR-036）。
 *
 * whisper.cpp は発言の開始・終了だけを元の時間軸へ戻すため、飛び飛びの発話が
 * 1 つの発言にまとまると、間の無音ごと何分にも伸びる（ハードウェアでミュートした
 * マイクの録音で 642 秒の発言に 22 文字、という実例があった）。トークンの時刻は
 * 詰めたあとの時間軸なので、区間の境目ごとに近くのトークンの切れ目を探して切る。
 * トークンの時刻は境目からずれるので、1 つずつ区間へ振り分けることはせず、
 * 句読点の切れ目に寄せる（`cutIndexFor`）。
 *
 * 切ると本文が崩れうるときは切らない。トークンの文字を繋いで本文に戻らない
 * （マルチバイト文字がトークンの境目で割れて置き換わった等）ときと、時刻を持たない
 * トークンがあるときは、whisper の発言をそのまま返す。
 */
const splitAtVadGaps = (piece: SegmentPiece, spans: readonly VadSpan[]): SegmentPiece[] => {
  // 発言の開始・終了は元の時間軸に戻っているので、どの区間にまたがるかはこちらで決まる。
  const covered = spans.filter((span) => span.origStartMs < piece.endMs && span.origEndMs > piece.startMs)
  const grazes = (span: VadSpan | undefined): boolean =>
    covered.length >= 2 &&
    span !== undefined &&
    Math.min(span.origEndMs, piece.endMs) - Math.max(span.origStartMs, piece.startMs) < EDGE_OVERLAP_MS
  const grazedHead = grazes(covered[0])
  if (grazedHead) covered.shift()
  const grazedTail = grazes(covered[covered.length - 1])
  if (grazedTail) covered.pop()
  const firstSpan = covered[0]
  const lastSpan = covered[covered.length - 1]
  if (!firstSpan || !lastSpan || (covered.length < 2 && !grazedHead && !grazedTail)) return [piece]
  // 区間をまたいでいた発言は、切る所が無くても両端を区間に収める。whisper の開始・終了は
  // 区間の外の無音にあることがあり（詰めたあとの時刻が区間の頭の直前に来ると、無音の中へ戻される）、
  // そのまま返すと前後の無音ごと伸びる。
  const within: SegmentPiece = {
    ...piece,
    startMs: Math.max(piece.startMs, firstSpan.origStartMs),
    endMs: Math.min(piece.endMs, lastSpan.origEndMs)
  }
  if (covered.length < 2) return [within]

  const words = piece.tokens.filter((token) => !SPECIAL_TOKEN.test(token.text ?? ''))
  const timed = words.flatMap((token): TimedToken[] => {
    const from = token.offsets?.from
    const to = token.offsets?.to
    const text = (token.text ?? '').trim()
    return typeof from === 'number' && typeof to === 'number' ? [{ token, text, from, to }] : []
  })
  if (timed.length === 0 || timed.length !== words.length) return [piece]
  if (
    words
      .map((token) => token.text ?? '')
      .join('')
      .trim() !== piece.text
  )
    return [piece]

  // 切る位置と、その位置の手前の発言が覆う最後の区間。
  const cuts: { index: number; lastSpan: number }[] = []
  for (let spanIndex = 0; spanIndex < covered.length - 1; spanIndex++) {
    const current = covered[spanIndex]
    const next = covered[spanIndex + 1]
    if (!current || !next) continue
    const index = cutIndexFor(
      timed,
      cuts[cuts.length - 1]?.index ?? 0,
      (current.vadEndMs + next.vadStartMs) / 2,
      next.origStartMs - current.origEndMs >= LONG_GAP_MS
    )
    if (index !== undefined) cuts.push({ index, lastSpan: spanIndex })
  }
  if (cuts.length === 0) return [within]

  const bounds = [...cuts, { index: timed.length, lastSpan: covered.length - 1 }]
  return bounds.flatMap(({ index, lastSpan }, order): SegmentPiece[] => {
    const previous = bounds[order - 1]
    const first = covered[previous ? previous.lastSpan + 1 : 0]
    const last = covered[lastSpan]
    const tokens = timed.slice(previous?.index ?? 0, index).map(({ token }) => token)
    const text = tokens
      .map((token) => token.text ?? '')
      .join('')
      .trim()
    if (!first || !last || text.length === 0) return []
    return [
      {
        // whisper の開始・終了は区間の外へは出さない。区間の内側に収まっている
        // 端（発言の頭・お尻）は whisper の時刻の方が細かいので、そちらを残す。
        startMs: Math.max(piece.startMs, first.origStartMs),
        endMs: Math.min(piece.endMs, last.origEndMs),
        text,
        tokens
      }
    ]
  })
}

/** セグメントを落とす理由。落とさないなら undefined。 */
const dropReason = (text: string, logprob: number | undefined): DropReason | undefined => {
  if (NON_SPEECH.test(text)) return 'non-speech'
  if (isHallucination(text)) return 'boilerplate'
  if (logprob !== undefined && logprob < MIN_AVG_LOGPROB) return 'low-confidence'
  return undefined
}

/** whisper が挿入する非発話マーカー。 */
const NON_SPEECH = /^(\[[^\]]*\]|\([^)]*\)|♪+|＊+)$/

/**
 * 無音区間で whisper が生みやすい定型句。VAD をすり抜けた分の保険。
 *
 * whisper の学習データには字幕が大量に含まれるため、音声が無いと動画の
 * 締めの決まり文句を出力する。セグメント全体がこれらと一致したときだけ
 * 落とす（部分一致で消すと「資料の共有ありがとうございました」のような
 * 本物の発言まで失われる）。
 *
 * 載せるのは動画の文脈でしか出てこない固有性の高い言い回しに限る。
 * 「終わり」のような短く汎用的な語は、会議の締めで実際に発せられたものと
 * 区別がつかず、黙って消すほうが害が大きい。
 */
const HALLUCINATIONS: readonly string[] = [
  'ご視聴ありがとうございました',
  'ご視聴ありがとうございます',
  'ご清聴ありがとうございました',
  'ご清聴ありがとうございます',
  '最後までご視聴いただきありがとうございました',
  'チャンネル登録よろしくお願いします',
  'チャンネル登録高評価よろしくお願いします',
  'この動画が良かったと思ったらチャンネル登録よろしくお願いします',
  '次回の動画でお会いしましょう',
  // 英語の会議でも無音から同じ種類の定型句が生まれる（ADR-043）。比較は小文字で行う。
  'thank you for watching',
  'thanks for watching',
  'thank you so much for watching',
  'thanks for watching and see you next time',
  'please subscribe to my channel',
  'please like and subscribe',
  'see you in the next video'
]

/** 末尾の句読点や感嘆符は揺れるだけで意味を持たないため、比較前に落とす。 */
const stripTrailingPunctuation = (text: string): string => text.replace(/[。．.、，,！!？?〜~…\s]+$/u, '')

/** 英語は文頭の大文字が揺れる。日本語には影響しない。 */
const isHallucination = (text: string): boolean =>
  HALLUCINATIONS.includes(stripTrailingPunctuation(text).trim().toLowerCase())

/**
 * サンプルを 1 つも持たない WAV かどうか。
 *
 * WAV として読めないものは false を返して whisper に判断させる。ここで握り潰すと
 * 壊れたファイルまで「発話なし」になり、本当の失敗が見えなくなる。
 */
const hasNoSamples = async (wavPath: string): Promise<boolean> => {
  try {
    return (await wavDurationMs(wavPath)) === 0
  } catch {
    return false
  }
}

/** `--print-progress` が stderr に出す行。`progress =  21%` のように空白で桁を揃える。 */
const PROGRESS_LINE = /whisper_print_progress_callback:\s*progress\s*=\s*(\d+)%/

/**
 * stderr のチャンクから進捗の割合（0〜1）を読み取る関数を作る。
 *
 * stderr は行の区切りと無関係な単位で届くため、行が揃うまで溜めてから読む。
 * 切れ目でそのまま読むと「progress = 2」と「1%」に割れて、21% を取り逃がす。
 */
export const whisperProgressReader = (onProgress: (fraction: number) => void): ((chunk: string) => void) => {
  let pending = ''
  return (chunk) => {
    const lines = (pending + chunk).split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      const match = PROGRESS_LINE.exec(line)
      if (match?.[1]) onProgress(Number(match[1]) / 100)
    }
  }
}

/** whisper-cli を起動する処理。テストで差し替えられるよう切り出す。 */
export type WhisperRunner = (args: {
  binaryPath: string
  argv: readonly string[]
  /** stderr を届いた順に渡す。進捗を読むために使う。 */
  onStderr?: (chunk: string) => void
}) => Promise<void>

const defaultRunner: WhisperRunner = ({ binaryPath, argv, onStderr }) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      binaryPath,
      [...argv],
      // VAD を使うときはログを止めないので、長い会議では発話区間 1 つにつき 3 行ずつ増える。
      // 既定の 1MB を越えると whisper-cli ごと止められるため、上限を十分に上げておく。
      { maxBuffer: 64 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new TranscriptionError(describeFailure(binaryPath, error, stderr), { cause: error }))
          return
        }
        resolve()
      }
    )
    // execFile は stderr を溜めて失敗時の文言に使うので、その経路は残したまま横から覗く。
    if (onStderr) child.stderr?.on('data', (chunk: Buffer | string) => onStderr(String(chunk)))
  })

/** whisper-cli の失敗を、利用者が次に何をすべきか分かる理由へ翻訳する。 */
export const describeFailure = (binaryPath: string, error: unknown, stderr: string): ErrorReason => {
  const message = toMessage(error)
  if (/ENOENT/.test(message)) return { code: 'whisperNotFound', binaryPath }
  if (/failed to initialize|load model|no such file/i.test(`${message}${stderr}`)) {
    return { code: 'whisperModelLoadFailed' }
  }
  if (/unknown argument: --vad|invalid argument: --vad/i.test(`${message}${stderr}`)) {
    return { code: 'whisperVadUnsupported', binaryPath }
  }
  return { code: 'transcriptionFailed', detail: message }
}

/**
 * whisper.cpp（whisper-cli）で音声をテキスト化する。
 *
 * トラックごとに個別実行し、得られた全セグメントへ呼び出し側が指定した話者 ID を
 * 付与する。マイクとシステム音声を分けて渡すことで、推論なしに自分と相手を分離できる。
 */
export class WhisperCppTranscriber implements TranscriptionPort {
  constructor(
    private readonly config: {
      binaryPath: string
      modelPath: string
      /** 指定があるときだけ VAD を有効にする。未取得なら空文字が来る。 */
      vadModelPath?: string
      /** 先に見せておく用語。whisper が受け取れる形にするのはこのクラスの仕事。 */
      glossary?: readonly string[]
      threads?: number
      /**
       * 落としたセグメントの通知先。計測モードのときだけ渡す。
       * 未指定なら何も記録しない — 通常の利用で本文がログへ漏れないようにする。
       */
      onDropped?: DroppedSegmentReporter
    },
    private readonly run: WhisperRunner = defaultRunner
  ) {}

  async transcribe(params: {
    wavPath: string
    language: string
    speakerId: string
    onProgress?: (fraction: number) => void
  }): Promise<TranscriptSegment[]> {
    if (!this.config.modelPath) {
      throw new TranscriptionError({ code: 'transcriptionModelNotConfigured' })
    }

    // マイクの無い環境では mic.wav がヘッダだけで残る（ADR-017）。whisper-cli は
    // 中身の無い WAV を読めず、JSON を書かないまま終了コード 0 で終わるため、
    // 起動させると「mic.json が無い」という無関係な ENOENT になって録音全体が失敗する。
    // 発話が 0 件なのは事実なので、空の結果として先へ進める。
    if (await hasNoSamples(params.wavPath)) return []

    // whisper-cli は <出力プレフィックス>.json を書き出す。
    const outputPrefix = params.wavPath.replace(/\.wav$/, '')
    const jsonPath = `${outputPrefix}.json`

    const prompt = glossaryPrompt(this.config.glossary ?? [], params.language)
    const vadModelPath = this.config.vadModelPath ?? ''

    const argv = [
      '--model',
      this.config.modelPath,
      '--file',
      params.wavPath,
      '--language',
      params.language,
      '--output-json',
      // トークンごとの確率（p）はフル出力にしか載らない。確信度の低いセグメントを
      // 落とす判断に要る。JSON は読み終えたら消すので、肥大しても保存先には残らない。
      '--output-json-full',
      '--output-file',
      outputPrefix,
      // VAD の発話区間の対応表はログにしか出ないので、VAD を使うときはログを止めない
      // （ADR-036）。使わないときは読むものが無いので止める。
      ...(vadModelPath ? [] : ['--no-prints']),
      // 進捗は --no-prints を付けたままでも stderr に出る。処理画面の割合表示に使う。
      '--print-progress',
      // 拍手や物音を表すトークンを抑制する。VAD をすり抜けた雑音の分だけ効く。
      '--suppress-nst',
      ...(vadModelPath ? ['--vad', '--vad-model', vadModelPath] : []),
      // --carry-initial-prompt が無いと用語集は先頭の 1 ウィンドウ（30 秒）にしか
      // 効かない。会議の長さを考えると、付けなければ入れた意味がほぼ無い。
      ...(prompt ? ['--prompt', prompt, '--carry-initial-prompt'] : []),
      // VAD を使わないと、雑音の区間で起きた繰り返しが直前の出力として次のウィンドウへ
      // 引き継がれ、録音の最後まで同じ文が続いて本物の発言を呑み込む（ADR-037）。
      // VAD を使うときは付けない。ループは起きず、句読点や重なった小さな声を落とすだけになる。
      // 用語集があるときも付けない。whisper.cpp は文脈の上限 0 で用語集まで入れなくなる。
      ...(vadModelPath || prompt ? [] : ['--max-context', '0']),
      ...(this.config.threads ? ['--threads', String(this.config.threads)] : [])
    ]

    // ログは読み終えるまで溜める。対応表の行は、届く単位で割れていることがある。
    let stderr = ''
    const readProgress = params.onProgress ? whisperProgressReader(params.onProgress) : undefined

    try {
      await this.run({
        binaryPath: this.config.binaryPath,
        argv,
        onStderr: (chunk) => {
          stderr += chunk
          readProgress?.(chunk)
        }
      })
      return parseWhisperJson(
        await readFile(jsonPath, 'utf8'),
        params.speakerId,
        this.config.onDropped,
        vadModelPath ? parseVadSpans(stderr) : []
      )
    } finally {
      // 中間 JSON は保存先を汚さないよう必ず片付ける。
      await rm(jsonPath, { force: true })
    }
  }
}
