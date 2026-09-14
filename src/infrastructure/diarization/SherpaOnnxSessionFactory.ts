import {
  DiarizationError,
  type DiarizationSession,
  type DiarizationSessionFactory
} from './SherpaOnnxDiarizer'
import { loadSherpa, missingModelMessage, sherpaThreads } from './sherpaModule'

/**
 * sherpa-onnx（ネイティブアドオン）で話者ダイアライゼーションのセッションを作る。
 *
 * モデルの存在確認を JS 側で先に行うのが要点。パスが不正なままネイティブへ渡すと
 * 原因の分からないエラーになり、利用者が何を直せばよいか分からなくなる。
 *
 * WASM 版（npm の `sherpa-onnx`）から乗り換えた経緯は ADR-028。
 */
export class SherpaOnnxSessionFactory implements DiarizationSessionFactory {
  async create(config: {
    segmentationModelPath: string
    embeddingModelPath: string
    clusteringThreshold: number
  }): Promise<DiarizationSession> {
    requireModel('話者分割モデル', config.segmentationModelPath)
    requireModel('話者埋め込みモデル', config.embeddingModelPath)

    const sherpa = await loadSherpa(
      (message, cause) =>
        new DiarizationError(
          `${message}話者識別を無効にすると、自分と参加者の 2 話者で処理を続行できます。`,
          { cause }
        )
    )
    const numThreads = sherpaThreads()

    const diarization = new sherpa.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: config.segmentationModelPath }, numThreads },
      embedding: { model: config.embeddingModelPath, numThreads },
      // numClusters を渡さないので threshold が話者数を決める。設定から来る値を
      // そのまま使い、ここで丸めない（範囲は validateSettings が保証する）。
      clustering: { numClusters: -1, threshold: config.clusteringThreshold },
      minDurationOn: 0.3,
      minDurationOff: 0.5
    })

    return {
      sampleRate: diarization.sampleRate,
      process: (samples) => diarization.process(samples),
      // ネイティブ側のハンドルに解放用の API は無く、GC 時にファイナライザが片付ける。
      // ワーカーはジョブごとに終了するので（ADR-008）、そこで確実に OS へ返る。
      dispose: () => undefined
    }
  }
}

const requireModel = (label: string, path: string): void => {
  const message = missingModelMessage(label, path)
  if (message) throw new DiarizationError(message)
}
