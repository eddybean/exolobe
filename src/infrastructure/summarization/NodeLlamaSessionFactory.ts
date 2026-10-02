import { totalmem } from 'node:os'
import { AppError, toMessage } from '@domain/errors'
import { headroomBytes, type MemoryProtection } from '@domain/MemoryGuard'
import type { LlmSession, LlmSessionFactory } from './LlamaCppSummarizer'

export class ModelLoadError extends AppError {}

/** getLlama に渡すもの。node-llama-cpp の GetLlamaOptions のうち、ここで決める部分。 */
export interface LlamaOptions {
  readonly gpu: { type: 'auto'; exclude: 'cuda'[] }
  readonly ramPadding?: number
}

/**
 * getLlama に渡す指定。
 *
 * GPU は CUDA を除いて自動で選ばせる。CUDA 版（@node-llama-cpp/win-x64-cuda*、数百 MB）は同梱しない
 * （ADR-048）。開発中は node_modules にあるので、除かないと CUDA Toolkit のある機体で配布版（Vulkan）と
 * 違う道筋を通り、確かめた振る舞いと配布版が食い違う。macOS は Metal を選ぶので影響しない。
 *
 * 余白は「保守的」のときだけ指定する。
 * node-llama-cpp は指定しなくても RAM の 25%（上限 6GB）と VRAM の 8%（上限 1.6GB）を
 * 余白として確保する。つまり内蔵ガードは既定で効いており、こちらの役目はそれを
 * 「締める」ことだけ。緩める方向には触らない。
 *
 * メモリ保護「オフ」でも既定のままにするのは、あの設定が外すのは事前チェックであって、
 * OS を守る余白そのものではないため。外せば OS が固まりやすくなり、目的に反する。
 */
export const llamaOptionsFor = (protection: MemoryProtection, totalBytes: number): LlamaOptions => {
  const gpu: LlamaOptions['gpu'] = { type: 'auto', exclude: ['cuda'] }
  if (protection !== 'conservative') return { gpu }

  // 既定を下回る値を渡すと締めるどころか緩めてしまう。必ず大きい方を採る。
  const padding = Math.max(headroomBytes('conservative', totalBytes), libraryRamPadding(totalBytes))
  return { gpu, ramPadding: Math.floor(padding) }
}

/** node-llama-cpp の defaultLlamaRamPadding と同じ式（macOS と Windows。Linux だけ上限が 1GB）。 */
const libraryRamPadding = (totalBytes: number): number => Math.min(totalBytes * 0.25, 6 * 1_024 ** 3)

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
  async create(config: { modelPath: string; contextSize: number; protection: MemoryProtection }): Promise<LlmSession> {
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp')

    try {
      const llama = await getLlama(llamaOptionsFor(config.protection, totalmem()))
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
        { code: 'summaryModelLoadFailed', path: config.modelPath, detail: toMessage(error) },
        { cause: error }
      )
    }
  }
}
