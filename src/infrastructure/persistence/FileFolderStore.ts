import { join } from 'node:path'
import type { FolderRepositoryPort } from '@application/ports'
import type { Folder } from '@domain/Folder'
import type { StorageLocator } from './FileRecordingStore'
import { readStoredJson, replaceStoredJson } from './jsonFile'

export type { StorageLocator } from './FileRecordingStore'

const FOLDERS_FILE = 'folders.json'

const isFolderRecord = (value: unknown): value is Folder => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Folder>
  return typeof candidate.id === 'string' && typeof candidate.name === 'string'
}

/** Folder として解釈するキー。これ以外は新しい版が足したものとして書き戻しで残す。 */
const FOLDER_KEYS: readonly string[] = ['id', 'name', 'parentId']

const unknownKeysOf = (value: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !FOLDER_KEYS.includes(key)))

/** フォルダの定義（id/名前/親子関係）を保存先ルートの folders.json にまとめて保存する。 */
export class FileFolderRepository implements FolderRepositoryPort {
  constructor(private readonly locator: StorageLocator) {}

  async list(): Promise<Folder[]> {
    const stored = await readStoredJson(await this.path(), Array.isArray)
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
        return saved ? { ...folder, ...unknownKeysOf(saved) } : folder
      }),
      ...unreadable
    ])
  }

  private async path(): Promise<string> {
    return join(await this.locator.root(), FOLDERS_FILE)
  }
}
