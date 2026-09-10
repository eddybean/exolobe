import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { toMessage } from '@domain/errors'
import {
  DiarizationError,
  type DiarizationSession,
  type DiarizationSessionFactory
} from './SherpaOnnxDiarizer'

/**
 * sherpa-onnx（ネイティブアドオン）で話者ダイアライゼーションのセッションを作る。
 *
 * import はメソッド内で行う。ネイティブライブラリを読むのは実際に話者識別を走らせる
 * ときだけで十分で、アプリの起動時間とメモリを不必要に使わないため。
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
  }): Promise<DiarizationSession> {
    requireModel('話者分割モデル', config.segmentationModelPath)
    requireModel('話者埋め込みモデル', config.embeddingModelPath)

    const sherpa = pickSherpaExports(await load())
    const numThreads = diarizationThreads(availableParallelism())

    const diarization = new sherpa.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: config.segmentationModelPath }, numThreads },
      embedding: { model: config.embeddingModelPath, numThreads },
      clustering: { numClusters: -1, threshold: 0.5 },
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

/**
 * 推論に使うスレッド数。
 *
 * 論理コアの半分までに抑える。パイプラインは 1 ジョブずつ直列に走るとはいえ、
 * 全コアを占有すると処理中の操作が重くなる。4 を超えても速度はほとんど伸びない。
 */
export const diarizationThreads = (cpuCount: number): number =>
  Math.max(1, Math.min(4, Math.floor(cpuCount / 2)))

const requireModel = (label: string, path: string): void => {
  if (!existsSync(path)) {
    throw new DiarizationError(
      `${label}が見つかりません（${path}）。設定画面で取得し直すか、話者識別を無効にしてください。`
    )
  }
}

/** import() が返した名前空間。名前付き export はある場合と無い場合がある。 */
type SherpaNamespace = {
  OfflineSpeakerDiarization?: SherpaExports['OfflineSpeakerDiarization']
  default: SherpaExports
}

interface SherpaExports {
  OfflineSpeakerDiarization: typeof import('sherpa-onnx-node').OfflineSpeakerDiarization
}

/**
 * sherpa-onnx-node は CJS で `module.exports` を変数から組み立てているため、
 * Node の `import()` は名前付き export を推測できず default にしか入らない。
 * 変換系（vitest 等）では名前付きも生えるので、両方を見る。
 */
export const pickSherpaExports = (namespace: SherpaNamespace): SherpaExports =>
  namespace.OfflineSpeakerDiarization === undefined
    ? namespace.default
    : { OfflineSpeakerDiarization: namespace.OfflineSpeakerDiarization }

const load = async (): Promise<SherpaNamespace> => {
  try {
    return await import('sherpa-onnx-node')
  } catch (error: unknown) {
    throw new DiarizationError(
      `sherpa-onnx を読み込めませんでした（${toMessage(error)}）。` +
        '話者識別を無効にすると、自分と参加者の 2 話者で処理を続行できます。',
      { cause: error }
    )
  }
}
