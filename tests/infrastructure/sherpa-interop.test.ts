import { describe, expect, it } from 'vitest'
import { pickSherpaExports } from '@infrastructure/diarization/sherpaModule'

class FakeDiarization {
  readonly sampleRate = 16_000
  process(): { start: number; end: number; speaker: number }[] {
    return []
  }
}

class FakeExtractor {
  readonly dim = 192
}

const defaults = {
  OfflineSpeakerDiarization: FakeDiarization,
  SpeakerEmbeddingExtractor: FakeExtractor
} as never

/**
 * sherpa-onnx-node は CJS で、`module.exports` を変数から組み立てている。
 * Node の `import()` はそこから名前付き export を推測できず default にだけ入るため、
 * 名前付きだけを見ていると本番でだけ「クラスが無い」で落ちる。
 */
describe('pickSherpaExports', () => {
  it('名前付き export が無ければ default から取り出す', () => {
    const namespace = { default: defaults }

    expect(pickSherpaExports(namespace).OfflineSpeakerDiarization).toBe(FakeDiarization)
    expect(pickSherpaExports(namespace).SpeakerEmbeddingExtractor).toBe(FakeExtractor)
  })

  it('名前付き export があればそのまま使う', () => {
    const namespace = {
      OfflineSpeakerDiarization: FakeDiarization as never,
      SpeakerEmbeddingExtractor: FakeExtractor as never,
      default: { OfflineSpeakerDiarization: class Other extends FakeDiarization {} } as never
    }

    expect(pickSherpaExports(namespace).OfflineSpeakerDiarization).toBe(FakeDiarization)
    expect(pickSherpaExports(namespace).SpeakerEmbeddingExtractor).toBe(FakeExtractor)
  })
})

describe('pickSherpaExports（文字起こし）', () => {
  class FakeRecognizer {}
  class FakeVad {}
  class FakeResampler {}

  it('Haas に使う認識器・VAD・リサンプラも default から取り出す', () => {
    const exports = pickSherpaExports({
      default: {
        OfflineRecognizer: FakeRecognizer,
        Vad: FakeVad,
        LinearResampler: FakeResampler
      } as never
    })

    expect(exports.OfflineRecognizer).toBe(FakeRecognizer)
    expect(exports.Vad).toBe(FakeVad)
    expect(exports.LinearResampler).toBe(FakeResampler)
  })
})
