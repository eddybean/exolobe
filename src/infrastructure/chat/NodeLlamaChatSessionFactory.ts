import { totalmem } from 'node:os'
// 型だけの import はネイティブモジュールを読み込まない。実体は create の中で動的に読む。
import type { ChatHistoryItem } from 'node-llama-cpp'
import type { ChatTurn } from '@application/ports'
import { AppError, toMessage } from '@domain/errors'
import type { MemoryProtection } from '@domain/MemoryGuard'
import { llamaOptionsFor } from '@infrastructure/summarization/NodeLlamaSessionFactory'
import type { ChatLlmSession, ChatLlmSessionFactory } from './LlamaCppChat'

export class ChatModelLoadError extends AppError {}

/**
 * 記録にある事実を答える仕事なので低めに寄せる。
 * 0 にすると同じ言い回しに固まり、言い直しを頼んでも同じ文が返る。
 */
const TEMPERATURE = 0.3

/**
 * 1 回の生成の上限（思考と本文の合計）。
 *
 * 8 件ぶんの ToDo を並べると本文だけで 2,000 字を超える。思考のぶんを足しても
 * 収まるようにしておかないと、本文の途中で打ち切られる。
 */
const MAX_TOKENS = 4_096

/**
 * 思考に使わせるトークン数の上限。
 *
 * 既定はコンテキストの 75%（32K なら 24,576）で、MAX_TOKENS を軽く超える。
 * そのままだと思考だけで生成枠を使い切り、**本文を 1 文字も書かないまま打ち切られる**
 * （実測: 40 秒生成して本文 0 文字）。onTextChunk は思考を配らないので画面には何も出ない。
 *
 * かといって 0 にすると、モデルは考えるのをやめるのではなく**思考を本文として書き出す**。
 * 前置きが枠を食って、今度は答えが尻切れになる。使わせたうえで上限で抑え、
 * 本文のぶんを必ず残すのが正しい。
 */
const THOUGHT_TOKENS = 1_024

/**
 * node-llama-cpp で GGUF モデルを読み込み、会話用のセッションを作る。
 *
 * 要約用（NodeLlamaSessionFactory）と分けているのは、こちらが断片を逐次返し、
 * 履歴を入れ替えながら同じセッションを使い続けるため。余白の指定は同じ判断で
 * 良いので llamaOptionsFor を共有する。
 *
 * import をメソッド内で行うのも同じ理由 — ネイティブモジュールを読むのは
 * 実際に会話するときだけでよい。
 */
export class NodeLlamaChatSessionFactory implements ChatLlmSessionFactory {
  async create(config: {
    modelPath: string
    contextSize: number
    protection: MemoryProtection
  }): Promise<ChatLlmSession> {
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp')

    try {
      const llama = await getLlama(llamaOptionsFor(config.protection, totalmem()))
      const model = await llama.loadModel({ modelPath: config.modelPath })
      const context = await model.createContext({ contextSize: config.contextSize })
      const session = new LlamaChatSession({ contextSequence: context.getSequence() })

      return {
        setHistory: (system: string, turns: readonly ChatTurn[]) => {
          const history: ChatHistoryItem[] = [{ type: 'system', text: system }]
          for (const turn of turns) {
            history.push(
              turn.role === 'user' ? { type: 'user', text: turn.text } : { type: 'model', response: [turn.text] }
            )
          }
          session.setChatHistory(history)
        },
        prompt: async (text: string, promptOptions: { onChunk: (t: string) => void; signal?: AbortSignal }) => {
          // promptWithMeta を使うのは stopReason が要るため。上限で打ち切られたことを
          // 黙って飲み込むと、利用者には「答えが尻切れ」としか見えない。
          const result = await session.promptWithMeta(text, {
            onTextChunk: promptOptions.onChunk,
            ...(promptOptions.signal === undefined ? {} : { signal: promptOptions.signal }),
            // 中断を例外にしない。途中まで生成した文をそのまま返し、
            // 利用者が読みかけていた答えを消さない。
            stopOnAbortSignal: true,
            temperature: TEMPERATURE,
            maxTokens: MAX_TOKENS,
            budgets: { thoughtTokens: THOUGHT_TOKENS }
          })

          return { text: result.responseText, truncated: result.stopReason === 'maxTokens' }
        },
        dispose: async () => {
          await context.dispose()
          await model.dispose()
        }
      }
    } catch (error: unknown) {
      throw new ChatModelLoadError(
        { code: 'chatModelLoadFailed', path: config.modelPath, detail: toMessage(error) },
        { cause: error }
      )
    }
  }
}
