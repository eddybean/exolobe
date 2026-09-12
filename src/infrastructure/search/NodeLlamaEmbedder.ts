import { totalmem } from 'node:os'
import { basename } from 'node:path'
import type { Token } from 'node-llama-cpp'
import type { TextEmbedderPort } from '@application/ports'
import { ConfigurationError, toMessage } from '@domain/errors'
import type { MemoryProtection } from '@domain/MemoryGuard'
import { normalize } from '@domain/SemanticSearch'
import {
  ModelLoadError,
  llamaOptionsFor
} from '@infrastructure/summarization/NodeLlamaSessionFactory'

/**
 * 埋め込みのコンテキスト長。
 *
 * bge-m3 のような BERT 系は入力全体を 1 回で評価しないと正しいベクトルにならない。
 * node-llama-cpp は既定でバッチを 512 に抑えるため、コンテキストとバッチを同じ値で
 * 明示し、入力はそれに収まるよう切り詰める。チャンクは約 140 トークンなので、
 * 切り詰めが効くのは異常に長いクエリくらい。
 */
export const CONTEXT_TOKENS = 1_024
/** 先頭と末尾に付ける特殊トークンの分を空けておく。 */
export const MAX_INPUT_TOKENS = CONTEXT_TOKENS - 2

/** node-llama-cpp との境目。これより内側はモデル無しでテストできる。 */
export interface EmbeddingSession<T> {
  tokenize(text: string): readonly T[]
  /** 特殊トークンを付けて評価し、プーリング済みの（正規化前の）ベクトルを返す。 */
  embedTokens(tokens: readonly T[]): Promise<readonly number[]>
  dispose(): Promise<void>
}

export interface EmbeddingSessionFactory<T> {
  create(config: { modelPath: string; protection: MemoryProtection }): Promise<EmbeddingSession<T>>
}

/**
 * GGUF の埋め込みモデルで文字列をベクトルにする。
 *
 * 要約（NodeLlamaSessionFactory）と違い、読み込んだモデルをこのインスタンスが生きて
 * いる間は持ち続ける。検索は利用者が続けて何度も打ち直すもので、1 回ごとに 600MB を
 * 読み直すと待たされる。解放は検索ワーカーを終わらせることで行う。
 */
export class NodeLlamaEmbedder<T> implements TextEmbedderPort {
  readonly modelKey: string
  private session: Promise<EmbeddingSession<T>> | undefined

  constructor(
    private readonly config: { modelPath: string; protection: MemoryProtection },
    private readonly factory: EmbeddingSessionFactory<T>
  ) {
    this.modelKey = basename(config.modelPath)
  }

  /** 読み込み中も含めて「メモリを確保しに行った後」か。 */
  get loaded(): boolean {
    return this.session !== undefined
  }

  async embed(text: string): Promise<Float32Array> {
    const session = await this.ensureSession()
    const tokens = session.tokenize(text).slice(0, MAX_INPUT_TOKENS)
    return normalize(await session.embedTokens(tokens))
  }

  async dispose(): Promise<void> {
    const session = this.session
    this.session = undefined
    if (session) await (await session).dispose()
  }

  /** 同期と検索が同時に最初の 1 回を呼んでも、読み込みは 1 回にする。 */
  private ensureSession(): Promise<EmbeddingSession<T>> {
    if (!this.config.modelPath) {
      return Promise.reject(
        new ConfigurationError(
          '意味検索のモデルが未取得です。設定画面の「モデル」からダウンロードしてください。'
        )
      )
    }

    if (!this.session) {
      this.session = this.factory.create(this.config).catch((error: unknown) => {
        // 失敗を覚えたままにすると、原因を取り除いても二度と読み込めなくなる。
        this.session = undefined
        throw error
      })
    }
    return this.session
  }
}

/** node-llama-cpp で埋め込み用のコンテキストを作る。import はメソッド内で行う。 */
export class NodeLlamaEmbeddingSessionFactory implements EmbeddingSessionFactory<Token> {
  async create(config: {
    modelPath: string
    protection: MemoryProtection
  }): Promise<EmbeddingSession<Token>> {
    const { getLlama } = await import('node-llama-cpp')

    try {
      const options = llamaOptionsFor(config.protection, totalmem())
      const llama = await (options ? getLlama(options) : getLlama())
      const model = await llama.loadModel({ modelPath: config.modelPath })
      const context = await model.createEmbeddingContext({
        contextSize: CONTEXT_TOKENS,
        batchSize: CONTEXT_TOKENS
      })
      return {
        tokenize: (text) => model.tokenize(text),
        embedTokens: async (tokens) => {
          // bge-m3 のトークナイザ（UGM）では node-llama-cpp が先頭の <s> を付けない。
          // CLS プーリングは先頭トークンの出力を使うので、明示的に付ける。
          const { bos, eos } = model.tokens
          const framed = [
            ...(bos === null ? [] : [bos]),
            ...tokens,
            ...(eos === null ? [] : [eos])
          ]
          return (await context.getEmbeddingFor(framed)).vector
        },
        dispose: async () => {
          await context.dispose()
          await model.dispose()
        }
      }
    } catch (error: unknown) {
      throw new ModelLoadError(
        `意味検索のモデルを読み込めませんでした（${config.modelPath}）: ${toMessage(error)}`,
        { cause: error }
      )
    }
  }
}
