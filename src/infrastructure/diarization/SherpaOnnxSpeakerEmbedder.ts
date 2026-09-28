import { basename } from 'node:path'
import type { SpeakerEmbeddingPort } from '@application/ports'
import { AppError, toMessage } from '@domain/errors'
import type { SpeakerTurn } from '@domain/TranscriptSegment'
import { normalize } from '@domain/vector'
import { readWav } from '@infrastructure/audio/wav'
import { selectVoiceRanges, type SampleRange } from './voiceSamples'

export class SpeakerEmbeddingError extends AppError {}

/**
 * 声紋を取り出さないフォールバック。
 *
 * 話者識別モデルが未設定のときに使う。話者の分割は従来どおり動き、名前が
 * 自動で入らないだけになる。
 */
export class NullSpeakerEmbedder implements SpeakerEmbeddingPort {
  readonly modelKey = ''

  async embedSpeakers(): Promise<{ speaker: string; vector: Float32Array }[]> {
    return []
  }
}

/** 1 回の抽出ぶんのセッション。sherpa-onnx を直接触らずこの seam を挟む。 */
export interface SpeakerEmbeddingSession {
  /** Float32 サンプル（[-1, 1]）から声紋を 1 本作る。 */
  compute(samples: Float32Array, sampleRate: number): Float32Array
  dispose(): void
}

export interface SpeakerEmbeddingSessionFactory {
  create(config: { embeddingModelPath: string }): Promise<SpeakerEmbeddingSession>
}

/**
 * 話者クラスタごとの声紋を取り出す。
 *
 * 話者分割が使うのと同じ埋め込みモデルを読む。分割側（OfflineSpeakerDiarization）は
 * クラスタ番号しか返さずベクトルを外に出さないため、同じ音をもう一度通す。
 * 抽出は分割に比べれば軽く、1 人あたり最大 30 秒ぶんで済む（voiceSamples.ts）。
 */
export class SherpaOnnxSpeakerEmbedder implements SpeakerEmbeddingPort {
  /**
   * モデルのファイル名。
   *
   * 中身のハッシュではなくファイル名にしてある。声紋帳との突き合わせに必要なのは
   * 「前と同じモデルか」だけで、数百 MB を毎回読んで確かめる価値は無い。
   */
  readonly modelKey: string

  constructor(
    private readonly config: { embeddingModelPath: string },
    private readonly factory: SpeakerEmbeddingSessionFactory
  ) {
    this.modelKey = basename(config.embeddingModelPath)
  }

  async embedSpeakers(params: {
    wavPath: string
    turns: readonly SpeakerTurn[]
  }): Promise<{ speaker: string; vector: Float32Array }[]> {
    const ranges = selectVoiceRanges(params.turns)
    if (ranges.size === 0) return []

    const audio = await readWav(params.wavPath)
    if (audio.samples.length === 0) return []
    // ステレオだと添字が 2 倍ずれ、例外にならないまま別の場所の音で声紋を作る。
    // パイプラインは常にモノラルを渡すが、静かに間違うより作らないほうが安全。
    if (audio.channels !== 1) return []

    const session = await this.factory.create(this.config)

    try {
      const result: { speaker: string; vector: Float32Array }[] = []
      for (const [speaker, speakerRanges] of ranges) {
        const samples = concatRanges(audio.samples, audio.sampleRate, speakerRanges)
        if (samples.length === 0) continue
        // sherpa の compute() はノルム 10 前後の生のベクトルを返す。ここで長さ 1 に
        // 揃えておかないと、照合の内積が「ノルム × コサイン」になり、閾値も
        // 2 位との差も桁ごと押し上げられて機能しない（別人に必ず名前が付く）。
        result.push({ speaker, vector: normalize(session.compute(samples, audio.sampleRate)) })
      }
      return result
    } catch (error: unknown) {
      throw new SpeakerEmbeddingError(
        { code: 'speakerEmbeddingFailed', detail: toMessage(error) },
        { cause: error }
      )
    } finally {
      session.dispose()
    }
  }
}

/**
 * 指定した範囲だけを繋いだ [-1, 1] の Float32 を作る。
 *
 * 範囲は録音の長さに丸める。ダイアライザが返す終了時刻は分割の窓に合わせて
 * 末尾をわずかに超えることがあり、そのまま切り出すと長さがずれる。
 */
const concatRanges = (
  samples: Int16Array,
  sampleRate: number,
  ranges: readonly SampleRange[]
): Float32Array => {
  const spans = ranges.map((range) => ({
    from: Math.max(0, Math.min(samples.length, Math.floor((range.startMs * sampleRate) / 1000))),
    to: Math.max(0, Math.min(samples.length, Math.floor((range.endMs * sampleRate) / 1000)))
  }))

  const total = spans.reduce((sum, span) => sum + Math.max(0, span.to - span.from), 0)
  const result = new Float32Array(total)

  let offset = 0
  for (const span of spans) {
    for (let index = span.from; index < span.to; index += 1) {
      result[offset] = (samples[index] ?? 0) / 32_768
      offset += 1
    }
  }

  return result
}
