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
  }[]
}

/**
 * whisper-cli の JSON 出力を TranscriptSegment へ変換する。
 *
 * whisper は無音区間で `[BLANK_AUDIO]` や `(音楽)` のようなプレースホルダを
 * 出すことがある。会議の文字起こしでは雑音になるため取り除く。
 */
export const parseWhisperJson = (raw: string, speakerId: string): TranscriptSegment[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error: unknown) {
    throw new TranscriptionError('文字起こし結果を読み取れませんでした。', { cause: error })
  }

  const entries = (parsed as WhisperJson).transcription
  if (!Array.isArray(entries)) return []

  return entries.flatMap((entry): TranscriptSegment[] => {
    const text = normalizeText(entry.text ?? '')
    if (text.length === 0) return []

    const startMs = entry.offsets?.from
    const endMs = entry.offsets?.to
    if (typeof startMs !== 'number' || typeof endMs !== 'number') return []

    return [{ startMs, endMs, speakerId, text }]
  })
}

/** whisper が挿入する非発話マーカーと余分な空白を落とす。 */
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

const normalizeText = (text: string): string => {
  const trimmed = text.trim()
  if (NON_SPEECH.test(trimmed) || isHallucination(trimmed)) return ''
  return trimmed
}

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

/** whisper-cli を起動する処理。テストで差し替えられるよう切り出す。 */
export type WhisperRunner = (args: {
  binaryPath: string
  argv: readonly string[]
}) => Promise<void>

const defaultRunner: WhisperRunner = ({ binaryPath, argv }) =>
  new Promise((resolve, reject) => {
    execFile(binaryPath, [...argv], (error, _stdout, stderr) => {
      if (error) {
        reject(new TranscriptionError(describeFailure(binaryPath, error, stderr), { cause: error }))
        return
      }
      resolve()
    })
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
    },
    private readonly run: WhisperRunner = defaultRunner
  ) {}

  async transcribe(params: {
    wavPath: string
    language: string
    speakerId: string
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

    const argv = [
      '--model',
      this.config.modelPath,
      '--file',
      params.wavPath,
      '--language',
      params.language,
      '--output-json',
      '--output-file',
      outputPrefix,
      '--no-prints',
      // 拍手や物音を表すトークンを抑制する。VAD をすり抜けた雑音の分だけ効く。
      '--suppress-nst',
      ...(this.config.vadModelPath
        ? ['--vad', '--vad-model', this.config.vadModelPath]
        : []),
      // --carry-initial-prompt が無いと用語集は先頭の 1 ウィンドウ（30 秒）にしか
      // 効かない。会議の長さを考えると、付けなければ入れた意味がほぼ無い。
      ...(prompt ? ['--prompt', prompt, '--carry-initial-prompt'] : []),
      ...(this.config.threads ? ['--threads', String(this.config.threads)] : [])
    ]

    try {
      await this.run({ binaryPath: this.config.binaryPath, argv })
      return parseWhisperJson(await readFile(jsonPath, 'utf8'), params.speakerId)
    } finally {
      // 中間 JSON は保存先を汚さないよう必ず片付ける。
      await rm(jsonPath, { force: true })
    }
  }
}
