import type { FolderDto, RecordingDto } from '@shared/ipc'

/**
 * ライブラリ（フォルダ＋録音）を 1 本のツリーに畳み込む。
 *
 * 「すべて」「未分類」は実体のないフォルダだが、行としてはフォルダと同じ形で
 * 扱いたい。ドロップ先の解釈だけが違うので kind で区別する。
 */
export type LibraryNodeKind = 'all' | 'unfiled' | 'folder'

export interface LibraryNode {
  /** 展開状態やドロップ先の識別子。フォルダなら折り畳みキー = フォルダ id。 */
  readonly key: string
  readonly kind: LibraryNodeKind
  readonly name: string
  /** 実フォルダのときだけ入る。録音のドロップ先として使う。 */
  readonly folderId?: string
  readonly children: readonly LibraryNode[]
  readonly recordings: readonly RecordingDto[]
}

const matches = (recording: RecordingDto, needle: string): boolean =>
  [recording.title, recording.summaryPreview ?? ''].some((text) =>
    text.toLowerCase().includes(needle)
  )

export const buildLibraryTree = (
  folders: readonly FolderDto[],
  recordings: readonly RecordingDto[],
  query: string
): LibraryNode[] => {
  const needle = query.trim().toLowerCase()
  const visible = needle ? recordings.filter((recording) => matches(recording, needle)) : recordings

  const byFolder = new Map<string, RecordingDto[]>()
  for (const recording of visible) {
    if (recording.folderId === undefined) continue
    const bucket = byFolder.get(recording.folderId)
    if (bucket) bucket.push(recording)
    else byFolder.set(recording.folderId, [recording])
  }

  const childFolders = new Map<string | undefined, FolderDto[]>()
  const known = new Set(folders.map((folder) => folder.id))
  for (const folder of folders) {
    // 親が消えているフォルダは根に出す。見えなくなって操作できなくなるより良い。
    const parentId =
      folder.parentId !== undefined && known.has(folder.parentId) ? folder.parentId : undefined
    const bucket = childFolders.get(parentId)
    if (bucket) bucket.push(folder)
    else childFolders.set(parentId, [folder])
  }

  const toNode = (folder: FolderDto): LibraryNode => ({
    key: folder.id,
    kind: 'folder',
    name: folder.name,
    folderId: folder.id,
    children: (childFolders.get(folder.id) ?? []).map(toNode),
    recordings: byFolder.get(folder.id) ?? []
  })

  return [
    { key: 'all', kind: 'all', name: 'すべて', children: [], recordings: visible },
    {
      key: 'unfiled',
      kind: 'unfiled',
      name: '未分類',
      children: [],
      recordings: visible.filter((recording) => recording.folderId === undefined)
    },
    ...(childFolders.get(undefined) ?? []).map(toNode)
  ]
}

/**
 * ユーザーの操作を待たずに開いておくべきノード。
 *
 * 検索中は当たった録音が隠れていては意味がないので、中身のあるノードを開く。
 * 選択中の録音は、どのフォルダに属しているのかが見えている方が分かりやすい。
 */
export const autoExpandedKeys = (
  nodes: readonly LibraryNode[],
  options: { query: string; selectedId?: string }
): Set<string> => {
  const searching = options.query.trim().length > 0
  const keys = new Set<string>()

  const walk = (node: LibraryNode): boolean => {
    const hasSelected =
      options.selectedId !== undefined &&
      node.recordings.some((recording) => recording.id === options.selectedId)
    // 子孫を先に辿らないと、祖先を開くべきか判断できない。
    const childHit = node.children.map(walk).some(Boolean)
    const hit = hasSelected || childHit || (searching && node.recordings.length > 0)

    if (hit) keys.add(node.key)
    return hit
  }

  for (const node of nodes) walk(node)
  return keys
}
