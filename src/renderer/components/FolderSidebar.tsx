import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactElement
} from 'react'
import type { FolderDto } from '@shared/ipc'

const RECORDING_MIME = 'application/x-recording-id'
const FOLDER_MIME = 'application/x-folder-id'

export type FolderSelection = 'all' | 'unfiled' | string

/**
 * フォルダ名を入力させるモーダル。
 *
 * window.prompt() は Electron のレンダラーでは実装されておらず、呼んでも
 * 即座に null が返るだけで何も表示されないため使わない。
 */
const FolderNameModal = ({
  title,
  onCommit,
  onCancel
}: {
  title: string
  onCommit: (name: string) => void
  onCancel: () => void
}): ReactElement => {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const submit = (): void => {
    const name = draft.trim()
    if (name) onCommit(name)
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <h3 className="modal__title">{title}</h3>
        <input
          ref={inputRef}
          className="modal__input"
          placeholder="フォルダ名"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="modal__actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="submit" disabled={draft.trim().length === 0}>
            作成
          </button>
        </div>
      </form>
    </div>
  )
}

interface FolderNode extends FolderDto {
  children: FolderNode[]
}

const buildTree = (folders: readonly FolderDto[]): FolderNode[] => {
  const nodes = new Map<string, FolderNode>(
    folders.map((folder) => [folder.id, { ...folder, children: [] }])
  )
  const roots: FolderNode[] = []

  for (const folder of folders) {
    const node = nodes.get(folder.id)
    if (!node) continue
    if (folder.parentId !== undefined && nodes.has(folder.parentId)) {
      nodes.get(folder.parentId)?.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

/**
 * 左サイドバーのフォルダツリー。
 *
 * 録音カードやフォルダ行自体をドラッグしてドロップすると、それぞれ
 * 「録音をフォルダへ割り当て」「フォルダの親子を入れ替え」が起きる。
 */
export const FolderSidebar = ({
  folders,
  selected,
  onSelect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  onMoveRecording
}: {
  folders: readonly FolderDto[]
  selected: FolderSelection
  onSelect: (selection: FolderSelection) => void
  onCreateFolder: (params: { name: string; parentId?: string }) => void
  onRenameFolder: (folderId: string, name: string) => void
  onDeleteFolder: (folderId: string) => void
  onMoveFolder: (folderId: string, parentId: string | undefined) => void
  onMoveRecording: (recordingId: string, folderId: string | undefined) => void
}): ReactElement => {
  const [dropTarget, setDropTarget] = useState<string | undefined>()
  const [createModal, setCreateModal] = useState<{ parentId?: string } | undefined>()

  const handleDrop = useCallback(
    (event: DragEvent, folderId: string | undefined) => {
      event.preventDefault()
      setDropTarget(undefined)

      const recordingId = event.dataTransfer.getData(RECORDING_MIME)
      if (recordingId) {
        onMoveRecording(recordingId, folderId)
        return
      }

      const draggedFolderId = event.dataTransfer.getData(FOLDER_MIME)
      if (draggedFolderId && draggedFolderId !== folderId) {
        onMoveFolder(draggedFolderId, folderId)
      }
    },
    [onMoveFolder, onMoveRecording]
  )

  const acceptDrop = useCallback((event: DragEvent, key: string) => {
    event.preventDefault()
    setDropTarget(key)
  }, [])

  const tree = buildTree(folders)

  return (
    <nav className="folders">
      <div className="folders__header">
        <h2>フォルダ</h2>
        <button
          type="button"
          className="folders__add"
          title="新規フォルダ"
          onClick={() => setCreateModal({})}
        >
          ＋
        </button>
      </div>

      <ul className="folders__list">
        <li>
          <button
            type="button"
            className={selected === 'all' ? 'folders__row folders__row--active' : 'folders__row'}
            onClick={() => onSelect('all')}
          >
            すべて
          </button>
        </li>
        <li>
          <button
            type="button"
            className={
              selected === 'unfiled'
                ? 'folders__row folders__row--active' +
                  (dropTarget === 'unfiled' ? ' folders__row--drop' : '')
                : 'folders__row' + (dropTarget === 'unfiled' ? ' folders__row--drop' : '')
            }
            onClick={() => onSelect('unfiled')}
            onDragOver={(event) => acceptDrop(event, 'unfiled')}
            onDragLeave={() => setDropTarget(undefined)}
            onDrop={(event) => handleDrop(event, undefined)}
          >
            未分類
          </button>
        </li>

        {tree.map((node) => (
          <FolderRow
            key={node.id}
            node={node}
            depth={0}
            selected={selected}
            dropTarget={dropTarget}
            onSelect={onSelect}
            onRequestCreateChild={(parentId) => setCreateModal({ parentId })}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            onDragOver={acceptDrop}
            onDragLeave={() => setDropTarget(undefined)}
            onDrop={handleDrop}
          />
        ))}
      </ul>

      {createModal && (
        <FolderNameModal
          title={createModal.parentId ? '子フォルダを作成' : '新規フォルダ'}
          onCommit={(name) => {
            onCreateFolder(
              createModal.parentId === undefined ? { name } : { name, parentId: createModal.parentId }
            )
            setCreateModal(undefined)
          }}
          onCancel={() => setCreateModal(undefined)}
        />
      )}
    </nav>
  )
}

const FolderRow = ({
  node,
  depth,
  selected,
  dropTarget,
  onSelect,
  onRequestCreateChild,
  onRenameFolder,
  onDeleteFolder,
  onDragOver,
  onDragLeave,
  onDrop
}: {
  node: FolderNode
  depth: number
  selected: FolderSelection
  dropTarget: string | undefined
  onSelect: (selection: FolderSelection) => void
  onRequestCreateChild: (parentId: string) => void
  onRenameFolder: (folderId: string, name: string) => void
  onDeleteFolder: (folderId: string) => void
  onDragOver: (event: DragEvent, key: string) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent, folderId: string | undefined) => void
}): ReactElement => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.name)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEditing = (): void => {
    setDraft(node.name)
    setEditing(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  const commit = (): void => {
    const name = draft.trim()
    if (name && name !== node.name) onRenameFolder(node.id, name)
    setEditing(false)
  }

  return (
    <li>
      <div
        className={
          (node.id === selected ? 'folders__row folders__row--active' : 'folders__row') +
          (dropTarget === node.id ? ' folders__row--drop' : '')
        }
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        draggable={!editing}
        onDragStart={(event) => {
          event.dataTransfer.setData(FOLDER_MIME, node.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(event) => onDragOver(event, node.id)}
        onDragLeave={onDragLeave}
        onDrop={(event) => onDrop(event, node.id)}
      >
        {editing ? (
          <input
            ref={inputRef}
            className="folders__row-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDraft(node.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <button type="button" className="folders__row-label" onClick={() => onSelect(node.id)}>
            {node.name}
          </button>
        )}

        <span className="folders__row-actions">
          <button
            type="button"
            title="子フォルダを作成"
            onClick={() => onRequestCreateChild(node.id)}
          >
            ＋
          </button>
          <button type="button" title="名前を変更" onClick={startEditing}>
            ✎
          </button>
          <button type="button" title="削除" onClick={() => onDeleteFolder(node.id)}>
            ✕
          </button>
        </span>
      </div>

      {node.children.length > 0 && (
        <ul className="folders__list">
          {node.children.map((child) => (
            <FolderRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              dropTarget={dropTarget}
              onSelect={onSelect}
              onRequestCreateChild={onRequestCreateChild}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
