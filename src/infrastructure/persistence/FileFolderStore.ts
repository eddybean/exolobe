import { join } from 'node:path'
import type { FolderRepositoryPort } from '@application/ports'
import type { Folder } from '@domain/Folder'
import { ConfigurationError } from '@domain/errors'
import type { StorageLocator } from './FileRecordingStore'
import { omitKeys, readStoredJson, replaceStoredJson } from './jsonFile'

export type { StorageLocator } from './FileRecordingStore'

const FOLDERS_FILE = 'folders.json'

const isFolderRecord = (value: unknown): value is Folder => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Folder>
  return typeof candidate.id === 'string' && typeof candidate.name === 'string'
}

/** Folder として解釈するキー。これ以外は新しい版が足したものとして書き戻しで残す。 */
const FOLDER_KEYS: readonly string[] = ['id', 'name', 'parentId']

/** フォルダの定義（id/名前/親子関係）を保存先ルートの folders.json にまとめて保存する。 */
export class FileFolderRepository implements FolderRepositoryPort {
  constructor(private readonly locator: StorageLocator) {}

  async list(): Promise<Folder[]> {
    // 一覧はアプリ起動直後に初期設定画面の裏でも読まれる。保存先が無い＝フォルダも無いので、
    // 録音の一覧（FileRecordingRepository.list）と同じく空として扱う。書き込みは従来どおり投げる。
    const root = await this.rootOrUndefined()
    if (root === undefined) return []

    const stored = await readStoredJson(join(root, FOLDERS_FILE), Array.isArray)
    return stored.kind === 'ok' ? stored.value.filter(isFolderRecord) : []
  }

  /**
   * 読んだ生の内容に重ねて置き換える。知らないキーは同じ id の要素に残し、
   * Folder と読めない要素はそのまま後ろに残す（ADR-035）。
   */
  async replaceAll(folders: readonly Folder[]): Promise<void> {
    const path = await this.path()
    const stored = await readStoredJson(path, Array.isArray)
    const previous: readonly unknown[] = stored.kind === 'ok' ? stored.value : []
    const known = new Map(previous.filter(isFolderRecord).map((entry) => [entry.id, entry]))
    const unreadable = previous.filter((entry) => !isFolderRecord(entry))

    await replaceStoredJson(path, stored, [
      ...folders.map((folder) => {
        const saved = known.get(folder.id)
        return saved ? { ...folder, ...omitKeys(saved, FOLDER_KEYS) } : folder
      }),
      ...unreadable
    ])
  }

  private async rootOrUndefined(): Promise<string | undefined> {
    try {
      return await this.locator.root()
    } catch (error: unknown) {
      if (error instanceof ConfigurationError) return undefined
      throw error
    }
  }

  private async path(): Promise<string> {
    return join(await this.locator.root(), FOLDERS_FILE)
  }
}
