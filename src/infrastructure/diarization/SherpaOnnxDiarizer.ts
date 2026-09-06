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

/** sherpa-onnx が返す 1 区間。秒単位・クラスタ番号で表される。 */
interface SherpaSegment {
  start: number
  end: number
  speaker: number
}

/**
 * sherpa-onnx のオフライン話者ダイアライゼーションで、相手トラックを話者ごとに分割する。
 *
 * 対象はシステム音声トラックだけでよい。マイクトラックは自分の発話であることが
 * 確定しているため推論に掛ける必要がなく、その分だけ精度と処理時間の両方で有利になる。
 *
 * N-API アドオンなので Electron の ABI に依存せずプリビルドがそのまま動くが、
 * 環境によっては読み込みに失敗し得る。呼び出し側（ProcessRecording）はこのステップの
 * 失敗を独立して扱い、文字起こしと要約は残す。
 */
export class SherpaOnnxDiarizer implements DiarizationPort {
  constructor(
    private readonly config: {
      segmentationModelPath: string
      embeddingModelPath: string
    }
  ) {}

  async diarize(params: { wavPath: string; maxSpeakers: number }): Promise<SpeakerTurn[]> {
    if (!this.config.segmentationModelPath || !this.config.embeddingModelPath) {
      throw new DiarizationError(
        '話者識別モデルが設定されていません。設定画面でモデルを選ぶか、話者識別を無効にしてください。'
      )
    }

    const audio = await readWav(params.wavPath)
    // 無音しか無いトラックに推論を掛けても意味が無く、モデルによっては失敗する。
    if (audio.samples.length === 0) return []

    const sherpa = await this.load()

    try {
      const diarizer = new sherpa.OfflineSpeakerDiarization({
        segmentation: { pyannote: { model: this.config.segmentationModelPath } },
        embedding: { model: this.config.embeddingModelPath },
        clustering: { numClusters: -1, threshold: 0.5 },
        minDurationOn: 0.3,
        minDurationOff: 0.5
      })

      // sherpa-onnx は [-1, 1] の Float32 を受け取る。
      const float = new Float32Array(audio.samples.length)
      for (let i = 0; i < audio.samples.length; i += 1) {
        float[i] = (audio.samples[i] ?? 0) / 32_768
      }

      const segments = diarizer.process(float) as SherpaSegment[]
      const turns = segments.map((segment) => ({
        startMs: Math.round(segment.start * 1000),
        endMs: Math.round(segment.end * 1000),
        speaker: `spk${segment.speaker}`
      }))

      return limitSpeakers(turns, params.maxSpeakers)
    } catch (error: unknown) {
      throw new DiarizationError(`話者識別に失敗しました: ${toMessage(error)}`, { cause: error })
    }
  }

  private async load(): Promise<{
    OfflineSpeakerDiarization: new (config: unknown) => { process(samples: Float32Array): unknown }
  }> {
    try {
      const module: unknown = await import('sherpa-onnx')
      return module as {
        OfflineSpeakerDiarization: new (config: unknown) => {
          process(samples: Float32Array): unknown
        }
      }
    } catch (error: unknown) {
      throw new DiarizationError(
        'sherpa-onnx を読み込めませんでした。話者識別を無効にすると、自分と参加者の 2 話者で処理を続行できます。',
        { cause: error }
      )
    }
  }
}
