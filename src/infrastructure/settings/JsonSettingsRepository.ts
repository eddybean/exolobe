import type { SettingsRepositoryPort } from '@application/ports'
import type { StorageLocator } from '@infrastructure/persistence/FileRecordingStore'
import {
  isPlainObject,
  readStoredJson,
  replaceVersionedJson,
  type StoredJson
} from '@infrastructure/persistence/jsonFile'
import { ConfigurationError } from '@domain/errors'
import {
  defaultSettings,
  legacySummaryPromptMode,
  mergeSettings,
  type Settings,
  type SettingsPatch
} from '@domain/Settings'
import type { MeetingLanguage } from '@domain/MeetingLanguage'

/**
 * 要約プロンプトの選び方（ADR-047）を持たない設定を読み替える。
 *
 * 既定値（`default`）で補うと、書き換えたプロンプトを持つ人の要約が黙って既定に戻る。
 * 選び方を足す前と同じく、本文が既定の全文と一致するかで決める。項目の追加なので
 * 形式の番号は上げない（ADR-035）。
 */
const withLegacyPromptMode = (settings: Settings, stored: SettingsPatch): Settings =>
  stored.summarization?.promptMode === undefined
    ? {
        ...settings,
        summarization: {
          ...settings.summarization,
          promptMode: legacySummaryPromptMode(settings.summarization.promptTemplate)
        }
      }
    : settings

/** settings.json の形式の番号。破壊的に変えたときだけ上げる（ADR-035）。 */
const SCHEMA_VERSION = 1

/**
 * 設定を 1 つの JSON ファイルに保存する。
 *
 * 保存済みの内容は既定値へマージして読み込むため、アプリの更新で設定項目が
 * 増えても古いファイルがそのまま使える。壊れていた場合も既定値で起動を続けるが、
 * 次に保存する前に元のファイルを退避する（ADR-035）。
 */
export class JsonSettingsRepository implements SettingsRepositoryPort {
  private cache: Settings | undefined
  /** 最後に読み書きしたファイルの生の内容。知らないキーを書き戻しで残すために持つ。 */
  private stored: StoredJson<Record<string, unknown>> = { kind: 'missing' }

  /**
   * @param language 設定ファイルが無いときの文字起こしの言語。UI の言語を渡す（ADR-043）。
   */
  constructor(
    private readonly filePath: string,
    private readonly language: MeetingLanguage
  ) {}

  async load(): Promise<Settings> {
    if (this.cache) return this.cache

    // 未作成・壊れた JSON は既定値で続行する。設定ファイルのせいで起動できない
    // 状態を作らない。
    this.stored = await readStoredJson(this.filePath, isPlainObject)
    const stored = this.stored.kind === 'ok' ? (this.stored.value as SettingsPatch) : {}
    this.cache = withLegacyPromptMode(mergeSettings(defaultSettings(this.language), stored), stored)
    return this.cache
  }

  async save(patch: SettingsPatch): Promise<Settings> {
    const merged = mergeSettings(await this.load(), patch)
    // 新しい版が足したキーは、この版が知らなくても残す。
    const written = { ...(this.stored.kind === 'ok' ? this.stored.value : {}), ...merged }

    await replaceVersionedJson(this.filePath, this.stored, SCHEMA_VERSION, written)

    this.stored = { kind: 'ok', value: written }
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
      throw new ConfigurationError({ code: 'storageNotConfigured' })
    }
    return storageDir
  }
}
