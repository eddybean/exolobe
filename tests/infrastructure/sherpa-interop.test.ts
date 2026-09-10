import { describe, expect, it } from 'vitest'
import { pickSherpaExports } from '@infrastructure/diarization/SherpaOnnxSessionFactory'

class FakeDiarization {
  readonly sampleRate = 16_000
  process(): { start: number; end: number; speaker: number }[] {
    return []
  }
}

/**
 * sherpa-onnx-node は CJS で、`module.exports` を変数から組み立てている。
 * Node の `import()` はそこから名前付き export を推測できず default にだけ入るため、
 * 名前付きだけを見ていると本番でだけ「クラスが無い」で落ちる。
 */
describe('pickSherpaExports', () => {
  it('名前付き export が無ければ default から取り出す', () => {
    const namespace = { default: { OfflineSpeakerDiarization: FakeDiarization } }

    expect(pickSherpaExports(namespace).OfflineSpeakerDiarization).toBe(FakeDiarization)
  })

  it('名前付き export があればそのまま使う', () => {
    const namespace = {
      OfflineSpeakerDiarization: FakeDiarization,
      default: { OfflineSpeakerDiarization: class Other extends FakeDiarization {} }
    }

    expect(pickSherpaExports(namespace).OfflineSpeakerDiarization).toBe(FakeDiarization)
  })
})
