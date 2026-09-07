import { join } from 'node:path'
import type { FolderRepositoryPort } from '@application/ports'
import type { Folder } from '@domain/Folder'
import type { StorageLocator } from './FileRecordingStore'
import { readJson, writeJsonAtomic } from './jsonFile'

export type { StorageLocator } from './FileRecordingStore'

const FOLDERS_FILE = 'folders.json'

const isFolderRecord = (value: unknown): value is Folder => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Folder>
  return typeof candidate.id === 'string' && typeof candidate.name === 'string'
}

/** フォルダの定義（id/名前/親子関係）を保存先ルートの folders.json にまとめて保存する。 */
export class FileFolderRepository implements FolderRepositoryPort {
  constructor(private readonly locator: StorageLocator) {}

  async list(): Promise<Folder[]> {
    const root = await this.locator.root()
    const value = await readJson(join(root, FOLDERS_FILE))
    return Array.isArray(value) ? value.filter(isFolderRecord) : []
  }

  async replaceAll(folders: readonly Folder[]): Promise<void> {
    const root = await this.locator.root()
    await writeJsonAtomic(join(root, FOLDERS_FILE), folders)
  }
}
