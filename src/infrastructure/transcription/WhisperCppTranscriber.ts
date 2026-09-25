import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import type { TranscriptionPort } from '@application/ports'
import { AppError, toMessage } from '@domain/errors'
import { glossaryPrompt } from '@domain/Glossary'
import type { TranscriptSegment } from '@domain/TranscriptSegment'
import { wavDurationMs } from '@infrastructure/audio/wav'

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
  [...stderr.matchAll(VAD_SPAN_LINE)].map(
    ([, origStart = '', origEnd = '', vadStart = '', vadEnd = '']) => ({
      origStartMs: secondsToMs(origStart),
      origEndMs: secondsToMs(origEnd),
      vadStartMs: secondsToMs(vadStart),
      vadEndMs: secondsToMs(vadEnd)
    })
  )

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
export const averageLogprob = (
  tokens: readonly { text?: string; p?: number }[] | undefined
): number | undefined => {
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
export type DropReason = 'non-speech' | 'boilerplate' | 'low-confidence'

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
    ...(dropped.avgLogprob === undefined
      ? []
      : [`logprob=${dropped.avgLogprob.toFixed(3)}`]),
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
    throw new TranscriptionError('文字起こし結果を読み取れませんでした。', { cause: error })
  }

  const entries = (parsed as WhisperJson).transcription
  if (!Array.isArray(entries)) return []

  return entries.flatMap((entry): TranscriptSegment[] => {
    const text = (entry.text ?? '').trim()
    if (text.length === 0) return []

    const startMs = entry.offsets?.from
    const endMs = entry.offsets?.to
    if (typeof startMs !== 'number' || typeof endMs !== 'number') return []

    const pieces = splitAtVadGaps({ startMs, endMs, text, tokens: entry.tokens ?? [] }, vadSpans)
    return pieces.flatMap((piece): TranscriptSegment[] => {
      const logprob = averageLogprob(piece.tokens)
      const reason = dropReason(piece.text, logprob)
      const segment = { startMs: piece.startMs, endMs: piece.endMs, speakerId, text: piece.text }
      if (reason === undefined) return [segment]

      onDropped?.({ ...segment, reason, ...(logprob === undefined ? {} : { avgLogprob: logprob }) })
      return []
    })
  })
}

interface SegmentPiece {
  readonly startMs: number
  readonly endMs: number
  readonly text: string
  readonly tokens: readonly WhisperToken[]
}

/**
 * 無音を詰めたあとの時刻が、どの発話区間のものか。
 *
 * 区間どうしの間には詰めたあとでも短い隙間（whisper.cpp が挟む 0.1〜0.2 秒）があり、
 * 区間の頭のトークンがそこに載ることがある（実測で「了」が 2.12 秒、次の区間は 2.18 秒から）。
 * 含む区間が無ければ、トークンの中点に最も近い区間に寄せる。
 */
const spanIndexOf = (spans: readonly VadSpan[], fromMs: number, toMs: number): number => {
  const middle = (fromMs + toMs) / 2
  let nearest = 0
  let nearestDistance = Infinity
  for (const [index, span] of spans.entries()) {
    const distance = Math.max(span.vadStartMs - middle, middle - span.vadEndMs, 0)
    if (distance < nearestDistance) {
      nearest = index
      nearestDistance = distance
    }
  }
  return nearest
}

/**
 * VAD の発話区間をまたいだ発言を、区間ごとに切り分ける（ADR-036）。
 *
 * whisper.cpp は発言の開始・終了だけを元の時間軸へ戻すため、飛び飛びの発話が
 * 1 つの発言にまとまると、間の無音ごと何分にも伸びる（ハードウェアでミュートした
 * マイクの録音で 642 秒の発言に 22 文字、という実例があった）。トークンの時刻は
 * 詰めたあとの時間軸なので、対応表で区間を引いて振り分ける。
 *
 * 切ると本文が崩れうるときは切らない。トークンの文字を繋いで本文に戻らない
 * （マルチバイト文字がトークンの境目で割れて置き換わった等）ときと、時刻を持たない
 * トークンがあるときは、whisper の発言をそのまま返す。
 */
const splitAtVadGaps = (piece: SegmentPiece, spans: readonly VadSpan[]): SegmentPiece[] => {
  if (spans.length < 2) return [piece]

  const words = piece.tokens.filter((token) => !SPECIAL_TOKEN.test(token.text ?? ''))
  const timed = words.flatMap((token) => {
    const from = token.offsets?.from
    const to = token.offsets?.to
    return typeof from === 'number' && typeof to === 'number' ? [{ token, from, to }] : []
  })
  if (timed.length === 0 || timed.length !== words.length) return [piece]
  if (words.map((token) => token.text ?? '').join('').trim() !== piece.text) return [piece]

  const groups: { spanIndex: number; tokens: WhisperToken[] }[] = []
  for (const { token, from, to } of timed) {
    const spanIndex = spanIndexOf(spans, from, to)
    const last = groups[groups.length - 1]
    if (last?.spanIndex === spanIndex) last.tokens.push(token)
    else groups.push({ spanIndex, tokens: [token] })
  }
  if (groups.length < 2) return [piece]

  return groups.flatMap(({ spanIndex, tokens }): SegmentPiece[] => {
    const span = spans[spanIndex]
    const text = tokens
      .map((token) => token.text ?? '')
      .join('')
      .trim()
    if (!span || text.length === 0) return []
    return [
      {
        // whisper の開始・終了は区間の外へは出さない。区間の内側に収まっている
        // 端（発言の頭・お尻）は whisper の時刻の方が細かいので、そちらを残す。
        startMs: Math.max(piece.startMs, span.origStartMs),
        endMs: Math.min(piece.endMs, span.origEndMs),
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
  '次回の動画でお会いしましょう'
]

/** 末尾の句読点や感嘆符は揺れるだけで意味を持たないため、比較前に落とす。 */
const stripTrailingPunctuation = (text: string): string =>
  text.replace(/[。．.、，,！!？?〜~…\s]+$/u, '')

const isHallucination = (text: string): boolean =>
  HALLUCINATIONS.includes(stripTrailingPunctuation(text))

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
export const whisperProgressReader = (
  onProgress: (fraction: number) => void
): ((chunk: string) => void) => {
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
          reject(
            new TranscriptionError(describeFailure(binaryPath, error, stderr), { cause: error })
          )
          return
        }
        resolve()
      }
    )
    // execFile は stderr を溜めて失敗時の文言に使うので、その経路は残したまま横から覗く。
    if (onStderr) child.stderr?.on('data', (chunk: Buffer | string) => onStderr(String(chunk)))
  })

/** whisper-cli の失敗を利用者が次に何をすべきか分かる文言へ翻訳する。 */
export const describeFailure = (binaryPath: string, error: unknown, stderr: string): string => {
  const message = toMessage(error)
  if (/ENOENT/.test(message)) {
    return `文字起こしに必要な ${binaryPath} が見つかりません。'npm run setup' を実行してください。`
  }
  if (/failed to initialize|load model|no such file/i.test(`${message}${stderr}`)) {
    return 'whisper のモデルを読み込めませんでした。設定画面でモデルのパスを確認してください。'
  }
  if (/unknown argument: --vad|invalid argument: --vad/i.test(`${message}${stderr}`)) {
    return `${binaryPath} が無音区間の除外（VAD）に対応していません。whisper.cpp を v1.7.6 以降に更新するか、設定画面で無音区間の除外を無効にしてください。`
  }
  return `文字起こしに失敗しました: ${message}`
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
      throw new TranscriptionError(
        '文字起こしモデルが設定されていません。設定画面でモデルを選んでください。'
      )
    }

    // マイクの無い環境では mic.wav がヘッダだけで残る（ADR-017）。whisper-cli は
    // 中身の無い WAV を読めず、JSON を書かないまま終了コード 0 で終わるため、
    // 起動させると「mic.json が無い」という無関係な ENOENT になって録音全体が失敗する。
    // 発話が 0 件なのは事実なので、空の結果として先へ進める。
    if (await hasNoSamples(params.wavPath)) return []

    // whisper-cli は <出力プレフィックス>.json を書き出す。
    const outputPrefix = params.wavPath.replace(/\.wav$/, '')
    const jsonPath = `${outputPrefix}.json`

    const prompt = glossaryPrompt(this.config.glossary ?? [])
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
