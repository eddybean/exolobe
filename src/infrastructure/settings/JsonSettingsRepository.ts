import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SettingsRepositoryPort } from '@application/ports'
import type { StorageLocator } from '@infrastructure/persistence/FileRecordingStore'
import { ConfigurationError } from '@domain/errors'
import {
  defaultSettings,
  mergeSettings,
  type Settings,
  type SettingsPatch
} from '@domain/Settings'

/**
 * 設定を 1 つの JSON ファイルに保存する。
 *
 * 保存済みの内容は既定値へマージして読み込むため、アプリの更新で設定項目が
 * 増えても古いファイルがそのまま使える。壊れていた場合も既定値で起動を続ける。
 */
export class JsonSettingsRepository implements SettingsRepositoryPort {
  private cache: Settings | undefined

  constructor(private readonly filePath: string) {}

  async load(): Promise<Settings> {
    if (this.cache) return this.cache

    let stored: SettingsPatch = {}
    try {
      stored = JSON.parse(await readFile(this.filePath, 'utf8')) as SettingsPatch
    } catch {
      // 未作成・壊れた JSON は既定値で続行する。設定ファイルのせいで起動できない
      // 状態を作らない。
    }

    this.cache = mergeSettings(defaultSettings(), stored)
    return this.cache
  }

  async save(patch: SettingsPatch): Promise<Settings> {
    const merged = mergeSettings(await this.load(), patch)

    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.tmp`
    await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    await rename(temporary, this.filePath)

    this.cache = merged
    return merged
  }
}

/** 設定から保存先を解決する。未設定のまま使われたら操作を促す。 */
export class SettingsStorageLocator implements StorageLocator {
  constructor(private readonly settings: SettingsRepositoryPort) {}

  async root(): Promise<string> {
    const { storageDir } = await this.settings.load()
    if (!storageDir) {
      throw new ConfigurationError(
        '保存先が設定されていません。設定画面から保存先を選んでください。'
      )
    }
    return storageDir
  }
}
