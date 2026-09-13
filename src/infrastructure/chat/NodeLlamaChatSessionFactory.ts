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

/** 1 回の回答の上限。議事録の要約より短くてよく、長引くと待ち時間が伸びるだけ。 */
const MAX_TOKENS = 1_024

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
      const options = llamaOptionsFor(config.protection, totalmem())
      const llama = await (options ? getLlama(options) : getLlama())
      const model = await llama.loadModel({ modelPath: config.modelPath })
      const context = await model.createContext({ contextSize: config.contextSize })
      const session = new LlamaChatSession({ contextSequence: context.getSequence() })

      return {
        setHistory: (system: string, turns: readonly ChatTurn[]) => {
          const history: ChatHistoryItem[] = [{ type: 'system', text: system }]
          for (const turn of turns) {
            history.push(
              turn.role === 'user'
                ? { type: 'user', text: turn.text }
                : { type: 'model', response: [turn.text] }
            )
          }
          session.setChatHistory(history)
        },
        prompt: (text: string, promptOptions: { onChunk: (t: string) => void; signal?: AbortSignal }) =>
          session.prompt(text, {
            onTextChunk: promptOptions.onChunk,
            ...(promptOptions.signal === undefined ? {} : { signal: promptOptions.signal }),
            // 中断を例外にしない。途中まで生成した文をそのまま返し、
            // 利用者が読みかけていた答えを消さない。
            stopOnAbortSignal: true,
            temperature: TEMPERATURE,
            maxTokens: MAX_TOKENS
          }),
        dispose: async () => {
          await context.dispose()
          await model.dispose()
        }
      }
    } catch (error: unknown) {
      throw new ChatModelLoadError(
        `チャット用のモデルを読み込めませんでした（${config.modelPath}）: ${toMessage(error)}`,
        { cause: error }
      )
    }
  }
}
