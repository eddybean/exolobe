/**
 * sherpa-onnx は型定義を同梱していないため、このアプリで使う範囲だけを宣言する。
 *
 * npm の `sherpa-onnx` は WASM ビルドで、公開されているのはファクトリ関数だけ。
 * クラスは export されていない（かつて `new sherpa.OfflineSpeakerDiarization(...)`
 * と書いて実行時に落ちていた）ため、ここで実際の形を書いて型で防ぐ。
 * ネイティブアドオン版が欲しい場合のパッケージ名は `sherpa-onnx-node` で別物。
 */
declare module 'sherpa-onnx' {
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

  export interface OfflineSpeakerDiarizationSegment {
    start: number
    end: number
    speaker: number
  }

  export interface OfflineSpeakerDiarization {
    /** 0 なら生成に失敗している（WASM 側はエラーを投げず 0 を返すことがある）。 */
    readonly handle: number
    readonly sampleRate: number
    process(samples: Float32Array): OfflineSpeakerDiarizationSegment[]
    free(): void
  }

  export function createOfflineSpeakerDiarization(
    config: OfflineSpeakerDiarizationConfig
  ): OfflineSpeakerDiarization

  export const version: string
}
