import { existsSync } from 'node:fs'
import { toMessage } from '@domain/errors'
import {
  DiarizationError,
  type DiarizationSession,
  type DiarizationSessionFactory
} from './SherpaOnnxDiarizer'

/**
 * sherpa-onnx（WASM ビルド）で話者ダイアライゼーションのセッションを作る。
 *
 * import はメソッド内で行う。数十 MB の WASM を読むのは実際に話者識別を走らせる
 * ときだけで十分で、アプリの起動時間とメモリを不必要に使わないため。
 *
 * モデルの存在確認を JS 側で先に行うのが要点。パスが不正なまま WASM へ渡すと
 * `null function or function signature mismatch` という原因の分からない
 * RuntimeError になり、利用者が何を直せばよいか分からなくなる。
 */
export class SherpaOnnxSessionFactory implements DiarizationSessionFactory {
  async create(config: {
    segmentationModelPath: string
    embeddingModelPath: string
  }): Promise<DiarizationSession> {
    requireModel('話者分割モデル', config.segmentationModelPath)
    requireModel('話者埋め込みモデル', config.embeddingModelPath)

    const sherpa = await load()

    const diarization = sherpa.createOfflineSpeakerDiarization({
      segmentation: { pyannote: { model: config.segmentationModelPath } },
      embedding: { model: config.embeddingModelPath },
      clustering: { numClusters: -1, threshold: 0.5 },
      minDurationOn: 0.3,
      minDurationOff: 0.5
    })

    if (diarization.handle === 0) {
      throw new DiarizationError(
        '話者識別の初期化に失敗しました。設定画面でモデルを取得し直してください。'
      )
    }

    return {
      sampleRate: diarization.sampleRate,
      process: (samples) => diarization.process(samples),
      dispose: () => diarization.free()
    }
  }
}

const requireModel = (label: string, path: string): void => {
  if (!existsSync(path)) {
    throw new DiarizationError(
      `${label}が見つかりません（${path}）。設定画面で取得し直すか、話者識別を無効にしてください。`
    )
  }
}

const load = async (): Promise<typeof import('sherpa-onnx')> => {
  try {
    return await import('sherpa-onnx')
  } catch (error: unknown) {
    throw new DiarizationError(
      `sherpa-onnx を読み込めませんでした（${toMessage(error)}）。` +
        '話者識別を無効にすると、自分と参加者の 2 話者で処理を続行できます。',
      { cause: error }
    )
  }
}
