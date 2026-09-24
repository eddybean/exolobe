import type { FolderDto, RecordingDto } from '@shared/ipc'

/**
 * ライブラリのフォルダの選び方。
 *
 * フォルダと録音を 1 本のツリーに入れ子で出していたが、フォルダを開くたびに録音が
 * 間に挟まって縦に伸び、目当てのフォルダまで遠かった。フォルダを上に並べて選び、
 * 下にその中身だけを出す。ボタンの列では親子を表せないので、選んだフォルダに子が
 * あれば子の列を 1 段ずつ足す。
 */

/** 「すべて」「未分類」は実体の無いフォルダ。選び方はフォルダと同じにしたい。 */
export type FolderKey = 'all' | 'unfiled' | string

export interface FolderChip {
  readonly key: FolderKey
  readonly kind: 'all' | 'unfiled' | 'folder'
  readonly name: string
  /** 子フォルダの中の録音も含めた件数。 */
  readonly count: number
  /** 選んでいるフォルダか、その祖先。どこにいるかを見せるために強調する。 */
  readonly onPath: boolean
}

const byId = (folders: readonly FolderDto[]): Map<string, FolderDto> =>
  new Map(folders.map((folder) => [folder.id, folder]))

/** 親の無い（消えた親を指す）フォルダは最上位に出す。見えなくなって操作できなくなるより良い。 */
const parentOf = (folder: FolderDto, known: Map<string, FolderDto>): string | undefined =>
  folder.parentId !== undefined && known.has(folder.parentId) ? folder.parentId : undefined

const childrenOf = (folders: readonly FolderDto[], parentId: string | undefined): FolderDto[] => {
  const known = byId(folders)
  return folders.filter((folder) => parentOf(folder, known) === parentId)
}

/** 根から folderId までのフォルダ。手で編集された循環があっても止まるよう、辿った先を覚える。 */
const ancestry = (folders: readonly FolderDto[], folderId: string): FolderDto[] => {
  const known = byId(folders)
  const path: FolderDto[] = []
  const seen = new Set<string>()
  let current = known.get(folderId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    const parentId = parentOf(current, known)
    current = parentId === undefined ? undefined : known.get(parentId)
  }
  return path
}

/** folderId と、その子孫すべての id。 */
const subtreeIds = (folders: readonly FolderDto[], folderId: string): Set<string> => {
  const ids = new Set([folderId])
  let grew = true
  while (grew) {
    grew = false
    for (const folder of folders) {
      if (folder.parentId !== undefined && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id)
        grew = true
      }
    }
  }
  return ids
}

/** 選んでいたフォルダが消えていたら「すべて」に戻す。 */
export const resolveFolderKey = (folders: readonly FolderDto[], key: FolderKey): FolderKey =>
  key === 'all' || key === 'unfiled' || byId(folders).has(key) ? key : 'all'

/**
 * 選んだフォルダの録音。子フォルダの中の録音も含める —— 親を選んだのに
 * 子に入れた録音が見えないと、選んだものより狭く見えてしまう。
 * 消えたフォルダを指す録音は「未分類」に出す。
 */
export const recordingsInFolder = <T extends Pick<RecordingDto, 'folderId'>>(
  folders: readonly FolderDto[],
  recordings: readonly T[],
  key: FolderKey
): T[] => {
  if (key === 'all') return [...recordings]

  const known = byId(folders)
  if (key === 'unfiled') {
    return recordings.filter(
      (recording) => recording.folderId === undefined || !known.has(recording.folderId)
    )
  }

  const ids = subtreeIds(folders, key)
  return recordings.filter(
    (recording) => recording.folderId !== undefined && ids.has(recording.folderId)
  )
}

/** 上に並べるフォルダの段。1 段目は最上位、以降は選んだフォルダの経路に沿って子を足す。 */
export const folderChipRows = (
  folders: readonly FolderDto[],
  recordings: readonly Pick<RecordingDto, 'folderId'>[],
  selected: FolderKey
): FolderChip[][] => {
  const key = resolveFolderKey(folders, selected)
  const path = key === 'all' || key === 'unfiled' ? [] : ancestry(folders, key)
  const onPath = new Set(path.map((folder) => folder.id))

  const chip = (folder: FolderDto): FolderChip => ({
    key: folder.id,
    kind: 'folder',
    name: folder.name,
    count: recordingsInFolder(folders, recordings, folder.id).length,
    onPath: onPath.has(folder.id)
  })

  const top: FolderChip[] = [
    { key: 'all', kind: 'all', name: 'すべて', count: recordings.length, onPath: key === 'all' },
    {
      key: 'unfiled',
      kind: 'unfiled',
      name: '未分類',
      count: recordingsInFolder(folders, recordings, 'unfiled').length,
      onPath: key === 'unfiled'
    },
    ...childrenOf(folders, undefined).map(chip)
  ]

  const nested = path
    .map((folder) => childrenOf(folders, folder.id).map(chip))
    .filter((row) => row.length > 0)

  return [top, ...nested]
}

/** 検索結果の行に添えるフォルダの位置。フォルダを横断して探すので、どこにあるかが要る。 */
export const folderPathLabel = (
  folders: readonly FolderDto[],
  folderId: string | undefined
): string => {
  if (folderId === undefined) return '未分類'
  const path = ancestry(folders, folderId)
  return path.length === 0 ? '未分類' : path.map((folder) => folder.name).join(' / ')
}

/** タイトルと要約の冒頭で絞り込む。本文は別の検索（searchTranscripts）が受け持つ。 */
export const filterByQuery = <T extends Pick<RecordingDto, 'title' | 'summaryPreview'>>(
  recordings: readonly T[],
  query: string
): T[] => {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...recordings]
  return recordings.filter((recording) =>
    [recording.title, recording.summaryPreview ?? ''].some((text) =>
      text.toLowerCase().includes(needle)
    )
  )
}
