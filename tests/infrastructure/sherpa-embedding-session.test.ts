import { describe, expect, it, vi } from 'vitest'

const extractorCalls: { compute: unknown[][] } = { compute: [] }

class FakeStream {
  accepted: { sampleRate: number; samples: Float32Array }[] = []
  acceptWaveform(params: { sampleRate: number; samples: Float32Array }): void {
    this.accepted.push(params)
  }
  inputFinished(): void {}
}

class FakeExtractor {
  readonly dim = 192
  createStream(): FakeStream {
    return new FakeStream()
  }
  compute(...args: unknown[]): Float32Array {
    extractorCalls.compute.push(args)
    return Float32Array.from([1, 0, 0])
  }
}

vi.mock('@infrastructure/diarization/sherpaModule', () => ({
  loadSherpa: async () => ({
    OfflineSpeakerDiarization: class {},
    SpeakerEmbeddingExtractor: FakeExtractor
  }),
  missingModelMessage: () => undefined,
  sherpaThreads: () => 2
}))

const { SherpaOnnxEmbeddingSessionFactory } = await import(
  '@infrastructure/diarization/SherpaOnnxEmbeddingSessionFactory'
)

/**
 * Electron の V8 は外部バッファ（napi_create_external_arraybuffer）を禁じており、
 * sherpa の既定のまま compute を呼ぶと「External buffers are not allowed」で落ちる。
 * 実測では素の Node では通り、Electron のプロセスでだけ失敗するため、テストが
 * 全て緑のまま本番でだけ声紋が取れない状態になる。
 */
describe('SherpaOnnxEmbeddingSessionFactory', () => {
  it('外部バッファを使わせずに声紋を受け取る', async () => {
    extractorCalls.compute = []
    const session = await new SherpaOnnxEmbeddingSessionFactory().create({
      embeddingModelPath: '/models/campplus.onnx'
    })

    const vector = session.compute(Float32Array.from([0.1, 0.2]), 16_000)

    expect(vector).toEqual(Float32Array.from([1, 0, 0]))
    expect(extractorCalls.compute).toHaveLength(1)
    // 第 2 引数が enableExternalBuffer。既定の true のままでは Electron で落ちる。
    expect(extractorCalls.compute[0]?.[1]).toBe(false)
  })
})
