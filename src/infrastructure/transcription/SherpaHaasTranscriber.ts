import type { TranscriptionPort } from '@application/ports'
import { AppError, toMessage } from '@domain/errors'
import type { TranscriptSegment } from '@domain/TranscriptSegment'
import { readWav } from '@infrastructure/audio/wav'
import { collapseRepeats, dropRepeatedSegments } from './repetition'
import { textDropReason, type DropReason, type DroppedSegmentReporter } from './segmentFilters'
import { TranscriptionError } from './WhisperCppTranscriber'

/** Haas-ja-v1.0（sherpa-onnx 形式）のファイルと、前に掛ける VAD。 */
export interface HaasModelPaths {
  readonly encoderPath: string
  readonly decoderPath: string
  readonly joinerPath: string
  readonly tokensPath: string
  readonly vadModelPath: string
}

/** VAD が見つけた 1 つの発話区間。位置はモデルのサンプルレートでのサンプル番号。 */
export interface HaasSpeechSpan {
  readonly startSample: number
  readonly samples: Float32Array
}

/** 1 区間の認識結果。時刻は区間の先頭からの秒。 */
export interface HaasRecognition {
  readonly tokens: readonly string[]
  readonly timestamps: readonly number[]
  readonly logProbs: readonly number[]
}

/**
 * 1 回の文字起こしぶんのセッション。sherpa-onnx を直接触らずこの seam を挟むことで、
 * 区切り方・時刻の換算・関門をネイティブ無しで検証できる（話者識別の DiarizationSession と同じ考え）。
 */
export interface HaasSession {
  /** モデルと VAD が前提とするサンプルレート。 */
  readonly sampleRate: number
  resample(samples: Float32Array, fromRate: number): Float32Array
  detectSpeech(samples: Float32Array): HaasSpeechSpan[]
  recognize(samples: Float32Array): HaasRecognition
  dispose(): void
}

export interface HaasSessionFactory {
  create(config: HaasModelPaths): Promise<HaasSession>
}

export interface SherpaHaasConfig extends HaasModelPaths {
  /**
   * これを下回る平均対数確率のセグメントを落とす。未指定なら確信度では落とさない。
   * whisper の -1 は whisper の確率の分布で決めた値で、Haas にそのまま当てはまる根拠が無い。
   */
  readonly minAvgLogprob?: number
  readonly onDropped?: DroppedSegmentReporter
}

/** 文末の記号。Haas は句読点を付けて出すので、長い発話区間はここで分ける。 */
const SENTENCE_END = /[。．？！?!]$/u

/**
 * 句点が無くても分ける間（秒）。VAD の区間には息継ぎ程度の間が含まれ、
 * 相づちと次の発言が 1 行にまとまると、話者識別で区間を割り当てるときに粒度が粗くなる。
 */
const PAUSE_SEC = 0.6

/**
 * Haas で頻出する定型句（小文字・末尾の句読点なしで書く）。whisper の一覧と同じく、
 * 会議では言われない、固有性の高い言い回しだけを載せる（ADR-049）。
 */
const HAAS_BOILERPLATE: readonly string[] = []

/**
 * Haas-ja-v1.0 を sherpa-onnx-node で動かす文字起こし（ADR-049）。
 *
 * whisper と違い、VAD で喋っている区間だけを切り出してから認識する。Haas は 30 秒前後の
 * 発話で学習されており、録音を丸ごと渡すとメモリが伸びるうえ、無音や BGM の区間からも
 * 文を作りうるため。区間の外は認識器に入らないので、そこからハルシネーションは生まれない。
 */
export class SherpaHaasTranscriber implements TranscriptionPort {
  constructor(
    private readonly config: SherpaHaasConfig,
    private readonly factory: HaasSessionFactory
  ) {}

  async transcribe(params: {
    wavPath: string
    language: string
    speakerId: string
    signal?: AbortSignal
    onProgress?: (fraction: number) => void
  }): Promise<TranscriptSegment[]> {
    const { encoderPath, decoderPath, joinerPath, tokensPath, vadModelPath } = this.config
    if (!encoderPath || !decoderPath || !joinerPath || !tokensPath || !vadModelPath) {
      throw new TranscriptionError({ code: 'haasModelNotConfigured' })
    }

    const audio = await readWav(params.wavPath)
    if (audio.samples.length === 0) return []

    const session = await this.factory.create(this.config)
    try {
      const pcm = toFloat(audio.samples)
      const samples = audio.sampleRate === session.sampleRate ? pcm : session.resample(pcm, audio.sampleRate)
      const pieces: Piece[] = []

      for (const span of session.detectSpeech(samples)) {
        params.signal?.throwIfAborted()
        const startSec = span.startSample / session.sampleRate
        const endSec = startSec + span.samples.length / session.sampleRate
        pieces.push(...splitSentences(session.recognize(span.samples), startSec, endSec))
        params.onProgress?.((span.startSample + span.samples.length) / samples.length)
      }
      params.onProgress?.(1)

      return this.filter(pieces, params.speakerId)
    } catch (error: unknown) {
      if (error instanceof AppError) throw error
      throw new TranscriptionError({ code: 'transcriptionFailed', detail: toMessage(error) }, { cause: error })
    } finally {
      // ネイティブが確保したメモリを抱えたまま次のトラックや話者識別へ進ませない。
      session.dispose()
    }
  }

  /** whisper と同じ順で関門に掛ける。ループを縮めてから定型句と確信度を見る。 */
  private filter(pieces: readonly Piece[], speakerId: string): TranscriptSegment[] {
    const { onDropped, minAvgLogprob } = this.config
    const segments = pieces.flatMap((piece): TranscriptSegment[] => {
      const { text, removed } = collapseRepeats(piece.text)
      const segment = { startMs: piece.startMs, endMs: piece.endMs, speakerId, text }
      if (removed) onDropped?.({ ...segment, text: removed, reason: 'repetition' })

      const reason: DropReason | undefined =
        textDropReason(text, HAAS_BOILERPLATE) ??
        (minAvgLogprob !== undefined && piece.avgLogprob < minAvgLogprob ? 'low-confidence' : undefined)
      if (reason === undefined) return [segment]

      onDropped?.({ ...segment, reason, avgLogprob: piece.avgLogprob })
      return []
    })

    const { kept, dropped } = dropRepeatedSegments(segments)
    for (const segment of dropped) onDropped?.({ ...segment, reason: 'repetition' })
    return kept
  }
}

interface Piece {
  readonly startMs: number
  readonly endMs: number
  readonly text: string
  readonly avgLogprob: number
}

/**
 * 1 区間の認識結果を文ごとに分ける。各文の終わりは次の文の最初のトークンの時刻、
 * 最後の文は区間の終わりにする（トークンの時刻は始まりしか表さないため）。
 */
const splitSentences = (result: HaasRecognition, startSec: number, endSec: number): Piece[] => {
  const groups: number[][] = []
  let current: number[] = []
  result.tokens.forEach((token, index) => {
    const previous = current[current.length - 1]
    if (previous !== undefined && at(result, index) - at(result, previous) >= PAUSE_SEC) {
      groups.push(current)
      current = []
    }
    current.push(index)
    if (SENTENCE_END.test(token)) {
      groups.push(current)
      current = []
    }
  })
  if (current.length > 0) groups.push(current)

  return groups.flatMap((group, index): Piece[] => {
    const first = group[0]
    if (first === undefined) return []
    const text = joinTokens(group.map((i) => result.tokens[i] ?? ''))
    if (text.length === 0) return []

    const next = groups[index + 1]?.[0]
    const probs = group.map((i) => result.logProbs[i] ?? 0)
    return [
      {
        startMs: Math.round((startSec + at(result, first)) * 1000),
        endMs: Math.round((next === undefined ? endSec : startSec + at(result, next)) * 1000),
        text,
        avgLogprob: probs.reduce((sum, p) => sum + p, 0) / probs.length
      }
    ]
  })
}

const at = (result: HaasRecognition, index: number): number => result.timestamps[index] ?? 0

/**
 * トークンをつなぐ。SentencePiece の語頭の印は空白として届くので、日本語の文字に接する空白は落とし、
 * 英単語どうしの間（「Google Meet」など）だけ残す。
 */
export const joinTokens = (tokens: readonly string[]): string =>
  decodeByteTokens(tokens.join(''))
    .replace(/\s+/gu, ' ')
    .replace(/ (?=[^\x00-\x7F])|(?<=[^\x00-\x7F]) /gu, '')
    .trim()

/**
 * 語彙（3,072 語）に無い字は、SentencePiece の byte fallback で UTF-8 の 1 バイトずつ `<0xE6>` の形で届く。
 * sherpa-onnx は全体の text では戻すが、トークンの列はそのままなので、文に分けて組み立てる側で戻す。
 * 連なりの途中で切れて UTF-8 として不完全なら、置換文字（U+FFFD）になる。
 */
const BYTE_TOKENS = /(?:<0x[0-9A-Fa-f]{2}>)+/gu

const decodeByteTokens = (text: string): string =>
  text.replace(BYTE_TOKENS, (run) =>
    new TextDecoder().decode(Uint8Array.from(run.match(/[0-9A-Fa-f]{2}(?=>)/gu) ?? [], (hex) => parseInt(hex, 16)))
  )

/** sherpa-onnx は [-1, 1] の Float32 を受け取る。 */
const toFloat = (samples: Int16Array): Float32Array => {
  const float = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) float[i] = (samples[i] ?? 0) / 32_768
  return float
}
