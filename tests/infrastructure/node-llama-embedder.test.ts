import { describe, expect, it } from 'vitest'
import { ConfigurationError } from '@domain/errors'
import {
  MAX_INPUT_TOKENS,
  NodeLlamaEmbedder,
  type EmbeddingSession,
  type EmbeddingSessionFactory
} from '@infrastructure/search/NodeLlamaEmbedder'

class FakeSession implements EmbeddingSession<number> {
  received: number[][] = []
  disposed = false
  output = [3, 4]

  tokenize(text: string): number[] {
    return [...text].map((_, index) => index)
  }
  async embedTokens(tokens: readonly number[]): Promise<readonly number[]> {
    this.received.push([...tokens])
    return this.output
  }
  async dispose(): Promise<void> {
    this.disposed = true
  }
}

class FakeFactory implements EmbeddingSessionFactory<number> {
  created = 0
  session = new FakeSession()
  failures = 0

  async create(): Promise<EmbeddingSession<number>> {
    this.created += 1
    if (this.failures > 0) {
      this.failures -= 1
      throw new Error('読み込めません')
    }
    return this.session
  }
}

const config = { modelPath: '/models/bge-m3-q8_0.gguf', protection: 'standard' as const }

describe('NodeLlamaEmbedder', () => {
  it('モデルのファイル名を互換キーにする', () => {
    expect(new NodeLlamaEmbedder(config, new FakeFactory()).modelKey).toBe('bge-m3-q8_0.gguf')
  })

  it('長さ 1 に正規化して返す（node-llama-cpp は正規化しない）', async () => {
    const vector = await new NodeLlamaEmbedder(config, new FakeFactory()).embed('雨')

    expect(Array.from(vector)).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)])
  })

  it('モデルの 1 回の入力に収まるようトークン数で切り詰める', async () => {
    const factory = new FakeFactory()

    await new NodeLlamaEmbedder(config, factory).embed('あ'.repeat(MAX_INPUT_TOKENS + 100))

    expect(factory.session.received[0]).toHaveLength(MAX_INPUT_TOKENS)
  })

  it('同時に呼ばれてもモデルは 1 回だけ読み込み、使い回す', async () => {
    const factory = new FakeFactory()
    const embedder = new NodeLlamaEmbedder(config, factory)

    await Promise.all([embedder.embed('a'), embedder.embed('b')])
    await embedder.embed('c')

    expect(factory.created).toBe(1)
  })

  it('読み込みに失敗したら、次の呼び出しで読み込み直す', async () => {
    const factory = new FakeFactory()
    factory.failures = 1
    const embedder = new NodeLlamaEmbedder(config, factory)

    await expect(embedder.embed('a')).rejects.toThrow('読み込めません')
    await expect(embedder.embed('a')).resolves.toBeInstanceOf(Float32Array)
    expect(factory.created).toBe(2)
  })

  it('モデルが未取得なら読み込みを試みず、取得を促す', async () => {
    const factory = new FakeFactory()

    await expect(
      new NodeLlamaEmbedder({ ...config, modelPath: '' }, factory).embed('a')
    ).rejects.toBeInstanceOf(ConfigurationError)
    expect(factory.created).toBe(0)
  })

  it('破棄するとモデルを解放する', async () => {
    const factory = new FakeFactory()
    const embedder = new NodeLlamaEmbedder(config, factory)
    await embedder.embed('a')

    await embedder.dispose()

    expect(factory.session.disposed).toBe(true)
  })
})
