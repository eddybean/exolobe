import { existsSync } from 'node:fs'
import { loadSherpa, sherpaThreads } from '@infrastructure/diarization/sherpaModule'
import type { HaasModelPaths, HaasSession, HaasSessionFactory, HaasSpeechSpan } from './SherpaHaasTranscriber'
import { TranscriptionError } from './WhisperCppTranscriber'

/** Haas と Silero VAD が前提とするサンプルレート。 */
const SAMPLE_RATE = 16_000

/** Silero VAD が 1 回に読むサンプル数（16kHz のとき 512 が決まり）。 */
const VAD_WINDOW = 512

/**
 * VAD の区切り方（ADR-049）。
 *
 * - minSilenceDuration: 息継ぎで区間が細切れにならず、話者の交代では切れる長さ。
 * - maxSpeechDuration: Haas は 30 秒前後までの発話で学習されている。長い独演は 20 秒で切り、
 *   認識器に渡すメモリも抑える（長く渡すほどエンコーダの確保が伸びる）。
 */
const VAD_OPTIONS = {
  threshold: 0.5,
  minSilenceDuration: 0.5,
  minSpeechDuration: 0.25,
  maxSpeechDuration: 20
} as const

/**
 * sherpa-onnx-node で Haas-ja-v1.0 と Silero VAD のセッションを作る。
 *
 * 変換版は sherpa-onnx の `nemo_transducer` として読める。特徴量は 128 次元の log-mel。
 * 用語集（hotwords）は modified_beam_search でしか効かず、TDT での動作を確かめていないので greedy で読む。
 */
export class SherpaHaasSessionFactory implements HaasSessionFactory {
  async create(config: HaasModelPaths): Promise<HaasSession> {
    for (const path of [
      config.encoderPath,
      config.decoderPath,
      config.joinerPath,
      config.tokensPath,
      config.vadModelPath
    ]) {
      // パスが不正なままネイティブへ渡すと、原因の分からないエラーになる。
      if (!existsSync(path)) throw new TranscriptionError({ code: 'haasModelNotConfigured' })
    }

    const sherpa = await loadSherpa(
      (detail, cause) => new TranscriptionError({ code: 'sherpaLoadFailed', detail, forDiarization: false }, { cause })
    )
    const numThreads = sherpaThreads()
    const recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 128 },
      modelConfig: {
        transducer: { encoder: config.encoderPath, decoder: config.decoderPath, joiner: config.joinerPath },
        tokens: config.tokensPath,
        numThreads,
        modelType: 'nemo_transducer',
        debug: 0
      },
      decodingMethod: 'greedy_search'
    })

    return {
      sampleRate: SAMPLE_RATE,
      resample: (samples, fromRate) => new sherpa.LinearResampler(fromRate, SAMPLE_RATE).flush(samples),
      detectSpeech: (samples) => {
        const vad = new sherpa.Vad(
          {
            sileroVad: { model: config.vadModelPath, windowSize: VAD_WINDOW, ...VAD_OPTIONS },
            sampleRate: SAMPLE_RATE,
            numThreads: 1,
            debug: 0
          },
          // 区間を溜めるバッファ。取り出しながら流すので、最長の区間より長ければ足りる。
          VAD_OPTIONS.maxSpeechDuration * 3
        )
        const spans: HaasSpeechSpan[] = []
        const drain = (): void => {
          while (!vad.isEmpty()) {
            // 外部バッファは Electron の V8 が禁じていて必ず失敗する（素の Node では通る）。
            const segment = vad.front(false)
            vad.pop()
            spans.push({ startSample: segment.start, samples: segment.samples })
          }
        }
        for (let i = 0; i + VAD_WINDOW <= samples.length; i += VAD_WINDOW) {
          vad.acceptWaveform(samples.subarray(i, i + VAD_WINDOW))
          drain()
        }
        vad.flush()
        drain()
        return spans
      },
      recognize: (samples) => {
        const stream = recognizer.createStream()
        stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
        recognizer.decode(stream)
        const result = recognizer.getResult(stream)
        return { tokens: result.tokens, timestamps: result.timestamps, logProbs: result.ys_log_probs }
      },
      // ネイティブ側のハンドルに解放用の API は無く、GC 時にファイナライザが片付ける。
      // ワーカーはジョブごとに終了するので（ADR-008）、そこで確実に OS へ返る。
      dispose: () => undefined
    }
  }
}
