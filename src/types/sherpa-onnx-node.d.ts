/**
 * sherpa-onnx-node は型定義を同梱していないため、このアプリで使う範囲だけを宣言する。
 *
 * WASM 版（npm の `sherpa-onnx`）ではなくネイティブアドオン版を使う。WASM の
 * ヒープは上限 2GB で拡張できず、40 分を超える録音の話者識別が確保できずに
 * 落ちていた（ADR-028）。こちらはクラス直呼びで、解放用の API は無い
 * （ハンドルは N-API のファイナライザが GC 時に片付ける）。
 */
declare module 'sherpa-onnx-node' {
  export interface OfflineSpeakerDiarizationConfig {
    segmentation: {
      pyannote: { model: string; windowShiftRatio?: number }
      numThreads?: number
      debug?: number
      provider?: string
    }
    embedding: {
      model: string
      numThreads?: number
      debug?: number
      provider?: string
    }
    clustering: { numClusters: number; threshold: number }
    minDurationOn?: number
    minDurationOff?: number
  }

  export interface SpeakerDiarizationSegment {
    start: number
    end: number
    speaker: number
  }

  export class OfflineSpeakerDiarization {
    constructor(config: OfflineSpeakerDiarizationConfig)
    /** モデルが前提とするサンプルレート。 */
    readonly sampleRate: number
    process(samples: Float32Array): SpeakerDiarizationSegment[]
  }

  /**
   * CJS の `module.exports`。Node の `import()` は名前付き export を推測できず
   * こちら側にしか入らないため、実装ではまず default を見る。
   */
  const sherpa: { OfflineSpeakerDiarization: typeof OfflineSpeakerDiarization }
  export default sherpa
}
