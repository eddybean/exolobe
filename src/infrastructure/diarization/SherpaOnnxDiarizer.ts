import type { DiarizationPort } from '@application/ports'
import { AppError, toMessage } from '@domain/errors'
import type { SpeakerTurn } from '@domain/TranscriptSegment'
import { readWav } from '@infrastructure/audio/wav'
import { limitSpeakers } from './turns'

export class DiarizationError extends AppError {}

/**
 * 話者識別を行わないフォールバック。
 *
 * 設定で無効にした場合や、モデルが用意できていない場合に使う。ターンを返さない
 * ため文字起こしは「自分／参加者」の 2 話者のままとなり、要望の必須部分は満たす。
 */
export class NullDiarizer implements DiarizationPort {
  async diarize(): Promise<SpeakerTurn[]> {
    return []
  }
}

/** 話者識別が返す 1 区間。秒単位・クラスタ番号で表される。 */
export interface DiarizationSegment {
  readonly start: number
  readonly end: number
  readonly speaker: number
}

/**
 * 1 回の推論ぶんのセッション。sherpa-onnx を直接触らずこの seam を挟むことで、
 * 正規化・変換・上限の各ロジックをネイティブ（WASM）無しで検証できる。
 */
export interface DiarizationSession {
  /** モデルが前提とするサンプルレート。この値と違う音声を渡すと時刻がずれる。 */
  readonly sampleRate: number
  process(samples: Float32Array): DiarizationSegment[]
  dispose(): void
}

export interface DiarizationSessionFactory {
  create(config: {
    segmentationModelPath: string
    embeddingModelPath: string
    clusteringThreshold: number
  }): Promise<DiarizationSession>
}

/**
 * オフライン話者ダイアライゼーションで、相手トラックを話者ごとに分割する。
 *
 * 対象はシステム音声トラックだけでよい。マイクトラックは自分の発話であることが
 * 確定しているため推論に掛ける必要がなく、その分だけ精度と処理時間の両方で有利になる。
 *
 * 呼び出し側（ProcessRecording）はこのステップの失敗を独立して扱うので、
 * ここで投げても文字起こしと要約は残る。
 */
export class SherpaOnnxDiarizer implements DiarizationPort {
  constructor(
    private readonly config: {
      segmentationModelPath: string
      embeddingModelPath: string
      clusteringThreshold: number
    },
    private readonly factory: DiarizationSessionFactory
  ) {}

  async diarize(params: { wavPath: string; maxSpeakers: number }): Promise<SpeakerTurn[]> {
    if (!this.config.segmentationModelPath || !this.config.embeddingModelPath) {
      throw new DiarizationError({ code: 'diarizationModelNotConfigured' })
    }

    const audio = await readWav(params.wavPath)
    // 無音しか無いトラックに推論を掛けても意味が無く、モデルによっては失敗する。
    if (audio.samples.length === 0) return []

    const session = await this.factory.create(this.config)

    try {
      // サンプルレートが違っても推論自体は通ってしまい、時刻だけが実際とずれた
      // 結果になる。黙って壊れた話者ターンを書き込むより、このステップを落とす。
      if (audio.sampleRate !== session.sampleRate) {
        throw new DiarizationError({
          code: 'diarizationSampleRate',
          modelRate: session.sampleRate,
          recordingRate: audio.sampleRate
        })
      }

      // sherpa-onnx は [-1, 1] の Float32 を受け取る。
      const float = new Float32Array(audio.samples.length)
      for (let i = 0; i < audio.samples.length; i += 1) {
        float[i] = (audio.samples[i] ?? 0) / 32_768
      }

      const turns = session.process(float).map((segment) => ({
        startMs: Math.round(segment.start * 1000),
        endMs: Math.round(segment.end * 1000),
        speaker: `spk${segment.speaker}`
      }))

      return limitSpeakers(turns, params.maxSpeakers)
    } catch (error: unknown) {
      if (error instanceof DiarizationError) throw error
      throw new DiarizationError({ code: 'diarizationFailed', detail: toMessage(error) }, { cause: error })
    } finally {
      // 失敗しても必ずセッションを閉じる。ネイティブが確保したメモリを抱えたまま
      // 次のステップ（要約は数 GB を使う）へ進ませない。
      session.dispose()
    }
  }
}
