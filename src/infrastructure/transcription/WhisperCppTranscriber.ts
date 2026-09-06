import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import type { TranscriptionPort } from '@application/ports'
import { AppError, toMessage } from '@domain/errors'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

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

const normalizeText = (text: string): string => {
  const trimmed = text.trim()
  return NON_SPEECH.test(trimmed) ? '' : trimmed
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

const describeFailure = (binaryPath: string, error: unknown, stderr: string): string => {
  const message = toMessage(error)
  if (/ENOENT/.test(message)) {
    return `文字起こしに必要な ${binaryPath} が見つかりません。'npm run setup' を実行してください。`
  }
  if (/failed to initialize|load model|no such file/i.test(`${message}${stderr}`)) {
    return 'whisper のモデルを読み込めませんでした。設定画面でモデルのパスを確認してください。'
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
    private readonly config: { binaryPath: string; modelPath: string; threads?: number },
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

    // whisper-cli は <出力プレフィックス>.json を書き出す。
    const outputPrefix = params.wavPath.replace(/\.wav$/, '')
    const jsonPath = `${outputPrefix}.json`

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
