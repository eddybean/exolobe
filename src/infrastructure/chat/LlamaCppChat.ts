import type { ChatCompletion, ChatCompletionPort, ChatTurn } from '@application/ports'
import { AppError } from '@domain/errors'
import type { MemoryProtection } from '@domain/MemoryGuard'

export class ChatError extends AppError {}

/**
 * モデルとの対話。node-llama-cpp を直接使わずこの seam を挟むことで、
 * 履歴の入れ替えと断片の受け渡しをモデル無しで検証できる（LlmSession と同じ役割）。
 */
export interface ChatLlmSession {
  setHistory(system: string, turns: readonly ChatTurn[]): void
  prompt(text: string, options: { onChunk: (text: string) => void; signal?: AbortSignal }): Promise<ChatCompletion>
  dispose(): Promise<void>
}

export interface ChatLlmSessionFactory {
  create(config: { modelPath: string; contextSize: number; protection: MemoryProtection }): Promise<ChatLlmSession>
}

/**
 * node-llama-cpp でローカル LLM と対話する。
 *
 * 要約（LlamaCppSummarizer）と違い、セッションはプロセスが生きている間だけ使い回す。
 * 5GB のモデルの読み込みは十数秒かかり、ターンごとに作り直しては会話にならない。
 * メモリを返すのはワーカーのプロセスごと終わるとき（ADR-008 と同じ考え方）。
 */
export class LlamaCppChat implements ChatCompletionPort {
  private session?: ChatLlmSession

  constructor(
    private readonly config: {
      modelPath: string
      contextSize: number
      protection: MemoryProtection
    },
    private readonly factory: ChatLlmSessionFactory
  ) {}

  async complete(params: {
    system: string
    history: readonly ChatTurn[]
    prompt: string
    onChunk: (text: string) => void
    signal?: AbortSignal
  }): Promise<ChatCompletion> {
    if (!this.config.modelPath) {
      throw new ChatError({ code: 'chatModelNotConfigured' })
    }

    this.session ??= await this.factory.create(this.config)

    /*
     * 履歴は毎ターン丸ごと入れ替える。
     *
     * 呼び出し側は問いのたびに文脈（要約の本文）を作り直してプロンプトに載せるので、
     * 前ターンの文脈がセッションに残ると、ターンを重ねるたびにコンテキストが
     * 二乗で膨らんで 32K がすぐ埋まる。履歴の正は画面側にあり、セッションの内部状態を
     * 正にすると二重管理になる。system が同じなら共通接頭辞の KV は再利用される。
     */
    const session = this.session
    session.setHistory(params.system, params.history)

    return session.prompt(params.prompt, {
      onChunk: params.onChunk,
      ...(params.signal === undefined ? {} : { signal: params.signal })
    })
  }

  /** ワーカーが終わるときに呼ぶ。モデルが抱えている数 GB を OS に返す。 */
  async dispose(): Promise<void> {
    const session = this.session
    if (!session) return

    delete this.session
    await session.dispose()
  }
}
