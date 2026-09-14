import {
  SpeakerEmbeddingError,
  type SpeakerEmbeddingSession,
  type SpeakerEmbeddingSessionFactory
} from './SherpaOnnxSpeakerEmbedder'
import { loadSherpa, missingModelMessage, sherpaThreads } from './sherpaModule'

/**
 * sherpa-onnx（ネイティブアドオン）で声紋抽出のセッションを作る。
 *
 * 話者分割に使うのと同じ埋め込みモデルを読む。分割側がクラスタ番号しか返さない
 * ため、声紋そのものはこちらで取り直す（ADR-031）。
 */
export class SherpaOnnxEmbeddingSessionFactory implements SpeakerEmbeddingSessionFactory {
  async create(config: { embeddingModelPath: string }): Promise<SpeakerEmbeddingSession> {
    const missing = missingModelMessage('話者埋め込みモデル', config.embeddingModelPath)
    if (missing) throw new SpeakerEmbeddingError(missing)

    const sherpa = await loadSherpa(
      (message, cause) => new SpeakerEmbeddingError(message, { cause })
    )
    const extractor = new sherpa.SpeakerEmbeddingExtractor({
      model: config.embeddingModelPath,
      numThreads: sherpaThreads()
    })

    return {
      compute: (samples, sampleRate) => {
        // ストリームは 1 人ぶんの声紋ごとに作り捨てる。使い回すと前の話者の音が
        // 残ったままになり、2 人目以降の声紋が混ざる。
        const stream = extractor.createStream()
        stream.acceptWaveform({ sampleRate, samples })
        stream.inputFinished()
        // 第 2 引数は enableExternalBuffer。既定の true だと sherpa が外部バッファで
        // 声紋を返し、Electron の V8（サンドボックス有効）が
        // 「External buffers are not allowed」で撥ねる。素の Node では通るので、
        // Fake を使うテストも素の Node での試行も緑のまま、アプリでだけ失敗する。
        return extractor.compute(stream, false)
      },
      // ネイティブ側のハンドルに解放用の API は無く、GC 時にファイナライザが片付ける。
      // ワーカーはジョブごとに終了するので（ADR-008）、そこで確実に OS へ返る。
      dispose: () => undefined
    }
  }
}
