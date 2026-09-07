import type { FolderRepositoryPort, IdGeneratorPort, RecordingRepositoryPort } from '@application/ports'
import { createFolder, isDescendant, type Folder } from '@domain/Folder'
import { ConfigurationError, RecordingNotFoundError } from '@domain/errors'
import type { Recording } from '@domain/Recording'

export interface FolderDeps {
  readonly folders: FolderRepositoryPort
  readonly recordings: RecordingRepositoryPort
  readonly ids: IdGeneratorPort
}

const findFolderOrThrow = async (folders: Folder[], folderId: string): Promise<Folder> => {
  const folder = folders.find((candidate) => candidate.id === folderId)
  if (!folder) throw new ConfigurationError('フォルダが見つかりません。')
  return folder
}

export class ListFolders {
  constructor(private readonly deps: FolderDeps) {}

  async execute(): Promise<Folder[]> {
    return this.deps.folders.list()
  }
}

export class CreateFolder {
  constructor(private readonly deps: FolderDeps) {}

  async execute(params: { name: string; parentId?: string | undefined }): Promise<Folder> {
    const current = await this.deps.folders.list()
    if (params.parentId !== undefined) {
      const parentExists = current.some((folder) => folder.id === params.parentId)
      if (!parentExists) throw new ConfigurationError('親フォルダが見つかりません。')
    }

    const folder = createFolder({
      id: this.deps.ids.next(),
      name: params.name,
      parentId: params.parentId
    })

    await this.deps.folders.replaceAll([...current, folder])
    return folder
  }
}

export class RenameFolder {
  constructor(private readonly deps: FolderDeps) {}

  async execute(params: { folderId: string; name: string }): Promise<Folder> {
    const current = await this.deps.folders.list()
    await findFolderOrThrow(current, params.folderId)

    const name = params.name.trim()
    if (name.length === 0) {
      throw new ConfigurationError('フォルダ名を入力してください。')
    }

    const updated = current.map((folder) =>
      folder.id === params.folderId ? { ...folder, name } : folder
    )
    await this.deps.folders.replaceAll(updated)
    return updated.find((folder) => folder.id === params.folderId) as Folder
  }
}

export class MoveFolder {
  constructor(private readonly deps: FolderDeps) {}

  async execute(params: { folderId: string; parentId?: string | undefined }): Promise<void> {
    const current = await this.deps.folders.list()
    await findFolderOrThrow(current, params.folderId)

    if (params.parentId !== undefined) {
      await findFolderOrThrow(current, params.parentId)
      const invalid =
        params.parentId === params.folderId ||
        isDescendant(current, params.folderId, params.parentId)
      if (invalid) {
        throw new ConfigurationError('自分自身や子孫フォルダの下には移動できません。')
      }
    }

    const updated = current.map((folder) =>
      folder.id === params.folderId ? { ...folder, parentId: params.parentId } : folder
    )
    await this.deps.folders.replaceAll(updated)
  }
}

/**
 * フォルダを削除する。中身（子フォルダ・録音）を失わないよう、
 * 削除対象の親フォルダ（トップレベルなら未分類）へ退避してから消す。
 */
export class DeleteFolder {
  constructor(private readonly deps: FolderDeps) {}

  async execute(params: { folderId: string }): Promise<void> {
    const current = await this.deps.folders.list()
    const target = await findFolderOrThrow(current, params.folderId)

    const reparented = current
      .filter((folder) => folder.id !== params.folderId)
      .map((folder) =>
        folder.parentId === params.folderId ? { ...folder, parentId: target.parentId } : folder
      )
    await this.deps.folders.replaceAll(reparented)

    const affected = (await this.deps.recordings.list()).filter(
      (recording) => recording.folderId === params.folderId
    )
    for (const recording of affected) {
      await this.deps.recordings.save({ ...recording, folderId: target.parentId })
    }
  }
}

export class MoveRecordingToFolder {
  constructor(private readonly deps: FolderDeps) {}

  async execute(params: { recordingId: string; folderId?: string | undefined }): Promise<Recording> {
    const recording = await this.deps.recordings.find(params.recordingId)
    if (!recording) throw new RecordingNotFoundError(params.recordingId)

    if (params.folderId !== undefined) {
      const folders = await this.deps.folders.list()
      await findFolderOrThrow(folders, params.folderId)
    }

    const moved = { ...recording, folderId: params.folderId }
    await this.deps.recordings.save(moved)
    return moved
  }
}
