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

  export interface SpeakerEmbeddingExtractorConfig {
    model: string
    numThreads?: number
    debug?: number
    provider?: string
  }

  /** 声紋の抽出に使う入力ストリーム。このアプリでは 1 本ぶんずつ使い捨てる。 */
  export interface OnlineStream {
    acceptWaveform(params: { sampleRate: number; samples: Float32Array }): void
    inputFinished(): void
  }

  export class SpeakerEmbeddingExtractor {
    constructor(config: SpeakerEmbeddingExtractorConfig)
    /** 声紋の次元数（3D-Speaker CampPlus は 192）。 */
    readonly dim: number
    createStream(): OnlineStream
    isReady(stream: OnlineStream): boolean
    compute(stream: OnlineStream, enableExternalBuffer?: boolean): Float32Array
  }

  export class OfflineSpeakerDiarization {
    constructor(config: OfflineSpeakerDiarizationConfig)
    /** モデルが前提とするサンプルレート。 */
    readonly sampleRate: number
    process(samples: Float32Array): SpeakerDiarizationSegment[]
  }

  /** 文字起こし（Haas-ja-v1.0、ADR-049）に使う範囲。 */
  export interface OfflineRecognizerConfig {
    featConfig: { sampleRate: number; featureDim: number }
    modelConfig: {
      transducer: { encoder: string; decoder: string; joiner: string }
      tokens: string
      numThreads?: number
      provider?: string
      debug?: number
      modelType?: string
    }
    decodingMethod?: 'greedy_search' | 'modified_beam_search'
  }

  export interface OfflineStream {
    acceptWaveform(params: { sampleRate: number; samples: Float32Array }): void
  }

  /** `OfflineRecognitionResult::AsJsonString()` の一部。時刻は秒。 */
  export interface OfflineRecognizerResult {
    text: string
    tokens: string[]
    timestamps: number[]
    ys_log_probs: number[]
  }

  export class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig)
    createStream(): OfflineStream
    decode(stream: OfflineStream): void
    getResult(stream: OfflineStream): OfflineRecognizerResult
  }

  export interface VadConfig {
    sileroVad: {
      model: string
      threshold?: number
      minSilenceDuration?: number
      minSpeechDuration?: number
      windowSize?: number
      maxSpeechDuration?: number
    }
    sampleRate: number
    numThreads?: number
    debug?: number
    provider?: string
  }

  export interface SpeechSegment {
    /** 先頭からのサンプル番号。 */
    start: number
    samples: Float32Array
  }

  export class Vad {
    constructor(config: VadConfig, bufferSizeInSeconds: number)
    acceptWaveform(samples: Float32Array): void
    isEmpty(): boolean
    pop(): void
    front(enableExternalBuffer?: boolean): SpeechSegment
    flush(): void
  }

  export class LinearResampler {
    constructor(inputSampleRate: number, outputSampleRate: number)
    flush(samples: Float32Array): Float32Array
  }

  /**
   * CJS の `module.exports`。Node の `import()` は名前付き export を推測できず
   * こちら側にしか入らないため、実装ではまず default を見る。
   */
  const sherpa: {
    OfflineSpeakerDiarization: typeof OfflineSpeakerDiarization
    SpeakerEmbeddingExtractor: typeof SpeakerEmbeddingExtractor
    OfflineRecognizer: typeof OfflineRecognizer
    Vad: typeof Vad
    LinearResampler: typeof LinearResampler
  }
  export default sherpa
}
