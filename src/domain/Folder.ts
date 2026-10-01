import { ConfigurationError } from './errors'

export interface Folder {
  readonly id: string
  readonly name: string
  /** 親フォルダの id。無ければトップレベル。 */
  readonly parentId?: string | undefined
}

export const createFolder = (params: { id: string; name: string; parentId?: string | undefined }): Folder => {
  const name = params.name.trim()
  if (name.length === 0) {
    throw new ConfigurationError({ code: 'folderNameRequired' })
  }

  return {
    id: params.id,
    name,
    ...(params.parentId === undefined ? {} : { parentId: params.parentId })
  }
}

/** candidateId が folderId の子孫（子・孫・…）かどうか。フォルダの付け替え時の循環防止に使う。 */
export const isDescendant = (folders: readonly Folder[], folderId: string, candidateId: string): boolean => {
  if (folderId === candidateId) return false

  let current = folders.find((folder) => folder.id === candidateId)
  while (current?.parentId !== undefined) {
    if (current.parentId === folderId) return true
    current = folders.find((folder) => folder.id === current?.parentId)
  }
  return false
}
