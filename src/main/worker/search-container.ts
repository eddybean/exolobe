import { join } from 'node:path'
import type { SettingsRepositoryPort } from '@application/ports'
import { SearchRecordings, SyncSearchIndex } from '@application/usecases/search'
import {
  FileRecordingArtifactStore,
  FileRecordingRepository
} from '@infrastructure/persistence/FileRecordingStore'
import { FileSearchIndex, SEARCH_INDEX_DIR } from '@infrastructure/search/FileSearchIndex'
import {
  NodeLlamaEmbedder,
  NodeLlamaEmbeddingSessionFactory
} from '@infrastructure/search/NodeLlamaEmbedder'
import {
  JsonSettingsRepository,
  SettingsStorageLocator
} from '@infrastructure/settings/JsonSettingsRepository'
import { NodeSystemResourceProbe } from '@infrastructure/system/NodeSystemResourceProbe'

export interface SearchServices {
  readonly sync: SyncSearchIndex
  readonly search: SearchRecordings
}

/**
 * 検索ワーカー用の依存を組み立てる。
 *
 * `electron` を import しないのが要点（pipeline-container と同じ理由）。
 *
 * パイプラインと違い、組み立てはワーカーの生存中に 1 回だけ行う。埋め込みモデルを
 * 読み込んだまま次の検索に使い回すため。モデルの差し替えは main がワーカーを
 * 終わらせることで反映する。
 */
export const createSearch = async (userDataPath: string): Promise<SearchServices> => {
  const settingsPath = join(userDataPath, 'settings.json')
  // ワーカーは長く生きるので、キャッシュを持つリポジトリを使い回すと、利用者が
  // 保存先や有効・無効を変えても古い値で動き続ける。読むたびにファイルから取り直す。
  const settings: SettingsRepositoryPort = {
    load: () => new JsonSettingsRepository(settingsPath).load(),
    save: (patch) => new JsonSettingsRepository(settingsPath).save(patch)
  }
  const current = await settings.load()
  const locator = new SettingsStorageLocator(settings)

  const system = new NodeSystemResourceProbe()
  const repository = new FileRecordingRepository(locator)
  const artifacts = new FileRecordingArtifactStore(locator, join(userDataPath, 'work'))
  const index = new FileSearchIndex(join(userDataPath, SEARCH_INDEX_DIR))
  const embedder = new NodeLlamaEmbedder(
    { modelPath: current.search.modelPath, protection: current.memoryProtection },
    new NodeLlamaEmbeddingSessionFactory()
  )

  return {
    sync: new SyncSearchIndex({
      repository,
      artifacts,
      index,
      embedder,
      settings,
      system
    }),
    search: new SearchRecordings({ repository, artifacts, index, embedder, settings, system })
  }
}
