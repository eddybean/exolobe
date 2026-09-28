import { join } from 'node:path'
import type { RecordingFinderPort, SettingsRepositoryPort } from '@application/ports'
import { AskChat } from '@application/usecases/chat'
import { LlamaCppChat } from '@infrastructure/chat/LlamaCppChat'
import { NodeLlamaChatSessionFactory } from '@infrastructure/chat/NodeLlamaChatSessionFactory'
import {
  FileRecordingArtifactStore,
  FileRecordingRepository
} from '@infrastructure/persistence/FileRecordingStore'
import {
  JsonSettingsRepository,
  SettingsStorageLocator
} from '@infrastructure/settings/JsonSettingsRepository'
import { NodeSystemResourceProbe } from '@infrastructure/system/NodeSystemResourceProbe'
import type { Locale } from '@shared/i18n/locale'

export interface ChatServices {
  readonly ask: AskChat
  /** ワーカーが終わるときに呼ぶ。モデルが抱えている数 GB を返す。 */
  readonly dispose: () => Promise<void>
}

/**
 * チャットワーカー用の依存を組み立てる。
 *
 * `electron` を import しないのが要点（pipeline-container / search-container と同じ理由）。
 *
 * 埋め込みモデルはここに載せない。5GB 級の LLM と 1.4GB の埋め込みを同じプロセスに
 * 置くと 16GB の機体で破綻する。話題語での絞り込みは finder 越しに main へ委ね、
 * main が意味検索のワーカー（別プロセス）で解決する。
 */
export const createChat = async (
  userDataPath: string,
  uiLocale: Locale,
  finder?: RecordingFinderPort
): Promise<ChatServices> => {
  const settingsPath = join(userDataPath, 'settings.json')
  // ワーカーは長く生きるので、キャッシュを持つリポジトリを使い回すと、利用者が
  // 保存先やモデルを変えても古い値で動き続ける。読むたびにファイルから取り直す。
  const settings: SettingsRepositoryPort = {
    load: () => new JsonSettingsRepository(settingsPath, uiLocale).load(),
    save: (patch) => new JsonSettingsRepository(settingsPath, uiLocale).save(patch)
  }
  const current = await settings.load()
  const locator = new SettingsStorageLocator(settings)

  const chat = new LlamaCppChat(
    {
      modelPath: current.summarization.modelPath,
      contextSize: current.summarization.contextSize,
      protection: current.memoryProtection
    },
    new NodeLlamaChatSessionFactory()
  )

  return {
    ask: new AskChat({
      repository: new FileRecordingRepository(locator),
      artifacts: new FileRecordingArtifactStore(locator, join(userDataPath, 'work')),
      settings,
      system: new NodeSystemResourceProbe(),
      clock: { now: () => new Date() },
      chat,
      ...(finder === undefined ? {} : { finder })
    }),
    dispose: () => chat.dispose()
  }
}
