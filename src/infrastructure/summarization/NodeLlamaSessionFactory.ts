import { totalmem } from 'node:os'
import { AppError, toMessage } from '@domain/errors'
import { headroomBytes, type MemoryProtection } from '@domain/MemoryGuard'
import type { LlmSession, LlmSessionFactory } from './LlamaCppSummarizer'

export class ModelLoadError extends AppError {}

/**
 * getLlama に渡す余白の指定。既定に任せる場合は undefined。
 *
 * node-llama-cpp は指定しなくても RAM の 25%（上限 6GB）と VRAM の 8%（上限 1.6GB）を
 * 余白として確保する。つまり内蔵ガードは既定で効いており、こちらの役目はそれを
 * 「締める」ことだけ。緩める方向には触らない。
 *
 * メモリ保護「オフ」でも既定のままにするのは、あの設定が外すのは事前チェックであって、
 * OS を守る余白そのものではないため。外せば OS が固まりやすくなり、目的に反する。
 */
export const llamaOptionsFor = (
  protection: MemoryProtection,
  totalBytes: number
): { ramPadding: number } | undefined => {
  if (protection !== 'conservative') return undefined

  // 既定を下回る値を渡すと締めるどころか緩めてしまう。必ず大きい方を採る。
  const padding = Math.max(headroomBytes('conservative', totalBytes), libraryRamPadding(totalBytes))
  return { ramPadding: Math.floor(padding) }
}

/** node-llama-cpp の defaultLlamaRamPadding（macOS）と同じ式。 */
const libraryRamPadding = (totalBytes: number): number =>
  Math.min(totalBytes * 0.25, 6 * 1_024 ** 3)

/**
 * node-llama-cpp で GGUF モデルを読み込み、1 回の要約ぶんのセッションを作る。
 *
 * Ollama のような常駐デーモンが不要なため、利用者は外部ツールを起動・管理せずに
 * 済む。モデルは要約のたびに読み込み、終わったら解放する。16GB RAM の機体では
 * whisper と同時に載せられないので、常駐させない方が全体としては速い。
 *
 * import はメソッド内で行う。ネイティブモジュールを読むのは実際に要約する時だけで
 * 十分で、アプリの起動時間とメモリを不必要に使わないため。
 */
export class NodeLlamaSessionFactory implements LlmSessionFactory {
  async create(config: {
    modelPath: string
    contextSize: number
    protection: MemoryProtection
  }): Promise<LlmSession> {
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp')

    try {
      const options = llamaOptionsFor(config.protection, totalmem())
      const llama = await (options ? getLlama(options) : getLlama())
      const model = await llama.loadModel({ modelPath: config.modelPath })
      const context = await model.createContext({ contextSize: config.contextSize })
      const session = new LlamaChatSession({ contextSequence: context.getSequence() })

      return {
        prompt: (text: string) => session.prompt(text),
        dispose: async () => {
          await context.dispose()
          await model.dispose()
        }
      }
    } catch (error: unknown) {
      throw new ModelLoadError(
        `要約モデルを読み込めませんでした（${config.modelPath}）: ${toMessage(error)}`,
        { cause: error }
      )
    }
  }
}
