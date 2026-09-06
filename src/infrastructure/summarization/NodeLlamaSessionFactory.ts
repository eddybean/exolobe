import { AppError, toMessage } from '@domain/errors'
import type { LlmSession, LlmSessionFactory } from './LlamaCppSummarizer'

export class ModelLoadError extends AppError {}

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
  async create(config: { modelPath: string; contextSize: number }): Promise<LlmSession> {
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp')

    try {
      const llama = await getLlama()
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
