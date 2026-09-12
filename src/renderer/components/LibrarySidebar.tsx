import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactElement
} from 'react'
import type { FolderDto, RecordingDto } from '@shared/ipc'
import { messageOf } from '../errorMessage'
import { isCommitEnter } from '../keyboard'
import { FOLDER_MIME, RECORDING_MIME } from '../library/fileDrop'
import { autoExpandedKeys, buildLibraryTree, type LibraryNode } from '../library/tree'
import { STATUS_LABELS } from '../format'
import { SemanticSearchResults, type SemanticSearchState } from './SemanticSearchResults'


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

/**
 * フォルダと録音を 1 本にまとめたライブラリのツリー。
 *
 * 3 ペインだと各列が狭くて読めなかったため、フォルダの中に録音を入れ子で出す。
 * 録音行はタイトルと処理状態だけの 1 行に絞り、日時や要約は詳細ペインに任せる。
 * 録音カードやフォルダ行をドラッグしてドロップすると、それぞれ
 * 「録音をフォルダへ割り当て」「フォルダの親子を入れ替え」が起きる。
 */
export const LibrarySidebar = ({
  folders,
  recordings,
  selectedId,
  onSelect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  onMoveRecording,
  onImport,
  importing,
  semanticAvailable
}: {
  folders: readonly FolderDto[]
  recordings: readonly RecordingDto[]
  /** 意味検索が有効でモデルもあるか。無ければ切り替え自体を出さない。 */
  semanticAvailable: boolean
  selectedId: string | undefined
  onSelect: (id: string) => void
  onCreateFolder: (params: { name: string; parentId?: string }) => void
  onRenameFolder: (folderId: string, name: string) => void
  onDeleteFolder: (folderId: string) => void
  onMoveFolder: (folderId: string, parentId: string | undefined) => void
  onMoveRecording: (recordingId: string, folderId: string | undefined) => void
  /** 音声ファイルの取り込みを始める（ファイル選択を出す）。 */
  onImport: () => void
  /** 取り込みの変換中。押しても待たされるだけなので操作を止める。 */
  importing: boolean
}): ReactElement => {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'keyword' | 'semantic'>('keyword')
  const [semantic, setSemantic] = useState<SemanticSearchState | undefined>()
  // 設定で無効にされたら、選んでいたモードに関わらずキーワードに戻す。
  const semanticMode = semanticAvailable && mode === 'semantic'
  const [dropTarget, setDropTarget] = useState<string | undefined>()
  const [createModal, setCreateModal] = useState<{ parentId?: string } | undefined>()
  /** ユーザーが明示的に開閉したノード。既定の開閉より優先する。 */
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map())

  // 意味検索のモードでは語句の絞り込みをしない。Enter を押すまでツリーは全件のまま。
  const keywordQuery = semanticMode ? '' : query
  const tree = useMemo(
    () => buildLibraryTree(folders, recordings, keywordQuery),
    [folders, recordings, keywordQuery]
  )
  const auto = useMemo(
    () =>
      autoExpandedKeys(
        tree,
        selectedId === undefined ? { query: keywordQuery } : { query: keywordQuery, selectedId }
      ),
    [tree, keywordQuery, selectedId]
  )

  // 検索語が変わると開くべきノードも変わるので、前の絞り込みでの開閉は捨てる。
  useEffect(() => {
    setToggled(new Map())
  }, [query])

  const isOpen = useCallback(
    (node: LibraryNode): boolean =>
      toggled.get(node.key) ?? (auto.has(node.key) || node.kind === 'all'),
    [toggled, auto]
  )

  const toggle = useCallback((node: LibraryNode, open: boolean): void => {
    setToggled((current) => new Map(current).set(node.key, open))
  }, [])

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

  const hasMatches = tree[0] !== undefined && tree[0].recordings.length > 0

  /**
   * 1 文字ごとに問い合わせるとモデルの計算が追いつかないので、Enter で確定させる。
   * 結果が返る前に次を打ったら、古い結果で上書きしない。
   */
  const latestSearch = useRef(0)
  const runSemanticSearch = (): void => {
    const text = query.trim()
    if (!text) return

    const ticket = latestSearch.current + 1
    latestSearch.current = ticket
    setSemantic({ kind: 'searching' })
    window.recorder
      .searchRecordings(text)
      .then((hits) => {
        if (latestSearch.current === ticket) setSemantic({ kind: 'done', hits })
      })
      .catch((error: unknown) => {
        if (latestSearch.current !== ticket) return
        setSemantic({ kind: 'error', message: messageOf(error) })
      })
  }

  const switchMode = (next: 'keyword' | 'semantic'): void => {
    setMode(next)
    setSemantic(undefined)
    latestSearch.current += 1
  }

  const showSemanticResults = semanticMode && semantic !== undefined && query.trim() !== ''

  return (
    <nav className="tree">
      <div className="tree__header">
        <div className="tree__header-row">
          <h2>ライブラリ</h2>
          <span className="tree__header-actions">
            {/* ドロップだけでは気付かれないので、明示的な入口をここに置く。 */}
            <button
              type="button"
              className="tree__add"
              title="音声ファイルを取り込む"
              aria-label="音声ファイルを取り込む"
              disabled={importing}
              onClick={onImport}
            >
              ⤓
            </button>
            <button
              type="button"
              className="tree__add"
              title="新規フォルダ"
              aria-label="新規フォルダ"
              onClick={() => setCreateModal({})}
            >
              ＋
            </button>
          </span>
        </div>
        <input
          type="search"
          className="tree__search"
          placeholder={
            semanticMode ? '例: 天気の話をした会議（Enter で検索）' : 'タイトル・要約で絞り込む'
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (semanticMode && isCommitEnter(event)) {
              event.preventDefault()
              runSemanticSearch()
            }
          }}
        />
        {semanticAvailable && (
          <fieldset className="semantic__modes" aria-label="検索の方法">
            <button
              type="button"
              className={semanticMode ? 'semantic__mode' : 'semantic__mode semantic__mode--active'}
              aria-pressed={!semanticMode}
              onClick={() => switchMode('keyword')}
            >
              キーワード
            </button>
            <button
              type="button"
              className={semanticMode ? 'semantic__mode semantic__mode--active' : 'semantic__mode'}
              aria-pressed={semanticMode}
              title="文章の意味で探します。例:「天気の話をした会議」"
              onClick={() => switchMode('semantic')}
            >
              意味
            </button>
          </fieldset>
        )}
      </div>

      {showSemanticResults && (
        <SemanticSearchResults state={semantic} selectedId={selectedId} onSelect={onSelect} />
      )}

      {!showSemanticResults && !hasMatches && (
        <p className="tree__empty">
          {recordings.length === 0 ? (
            <>
              録音はまだありません。下の「録音」ボタンで開始するか、
              <button type="button" className="tree__empty-link" onClick={onImport}>
                音声ファイルを取り込め
              </button>
              ます。
            </>
          ) : (
            '一致する録音がありません。'
          )}
        </p>
      )}

      {/*
        意味検索の結果を出している間はツリーを出さない。hidden 属性では
        `.tree__list` の display 指定に負けて消えないので、描画ごと分ける。
      */}
      {!showSemanticResults && (
        <ul className="tree__list">
          {tree.map((node) => (
            <TreeNode
              key={node.key}
              node={node}
              depth={0}
              selectedId={selectedId}
              dropTarget={dropTarget}
              isOpen={isOpen}
              onToggle={toggle}
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
      )}

      {createModal && (
        <FolderNameModal
          title={createModal.parentId ? '子フォルダを作成' : '新規フォルダ'}
          onCommit={(name) => {
            onCreateFolder(
              createModal.parentId === undefined
                ? { name }
                : { name, parentId: createModal.parentId }
            )
            setCreateModal(undefined)
          }}
          onCancel={() => setCreateModal(undefined)}
        />
      )}
    </nav>
  )
}

interface TreeNodeProps {
  node: LibraryNode
  depth: number
  selectedId: string | undefined
  dropTarget: string | undefined
  isOpen: (node: LibraryNode) => boolean
  onToggle: (node: LibraryNode, open: boolean) => void
  onSelect: (id: string) => void
  onRequestCreateChild: (parentId: string) => void
  onRenameFolder: (folderId: string, name: string) => void
  onDeleteFolder: (folderId: string) => void
  onDragOver: (event: DragEvent, key: string) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent, folderId: string | undefined) => void
}

const TreeNode = ({
  node,
  depth,
  selectedId,
  dropTarget,
  isOpen,
  onToggle,
  onSelect,
  onRequestCreateChild,
  onRenameFolder,
  onDeleteFolder,
  onDragOver,
  onDragLeave,
  onDrop
}: TreeNodeProps): ReactElement => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.name)
  const inputRef = useRef<HTMLInputElement>(null)

  const open = isOpen(node)
  const isFolder = node.kind === 'folder'
  // 「すべて」だけはドロップされても行き先が決まらないので受け付けない。
  const acceptsDrop = node.kind !== 'all'

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
    if (name && name !== node.name && node.folderId) onRenameFolder(node.folderId, name)
    setEditing(false)
  }

  const dropHandlers = acceptsDrop
    ? {
        onDragOver: (event: DragEvent) => onDragOver(event, node.key),
        onDragLeave,
        onDrop: (event: DragEvent) => onDrop(event, node.folderId)
      }
    : {}

  return (
    <li>
      <div
        className={
          'tree__folder' + (dropTarget === node.key ? ' tree__folder--drop' : '')
        }
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        draggable={isFolder && !editing}
        onDragStart={(event) => {
          if (!node.folderId) return
          event.dataTransfer.setData(FOLDER_MIME, node.folderId)
          event.dataTransfer.effectAllowed = 'move'
        }}
        {...dropHandlers}
      >
        {editing ? (
          <input
            ref={inputRef}
            className="tree__folder-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (isCommitEnter(event)) {
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
          <button
            type="button"
            className="tree__folder-label"
            aria-expanded={open}
            onClick={() => onToggle(node, !open)}
          >
            <span className="tree__caret" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            <span className="tree__folder-name">{node.name}</span>
            <span className="tree__count">{countRecordings(node)}</span>
          </button>
        )}

        {isFolder && (
          <span className="tree__folder-actions">
            <button
              type="button"
              title="子フォルダを作成"
              onClick={() => node.folderId && onRequestCreateChild(node.folderId)}
            >
              ＋
            </button>
            <button type="button" title="名前を変更" onClick={startEditing}>
              ✎
            </button>
            <button
              type="button"
              title="削除"
              onClick={() => node.folderId && onDeleteFolder(node.folderId)}
            >
              ✕
            </button>
          </span>
        )}
      </div>

      {open && (node.children.length > 0 || node.recordings.length > 0) && (
        <ul className="tree__list">
          {node.children.map((child) => (
            <TreeNode
              key={child.key}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              dropTarget={dropTarget}
              isOpen={isOpen}
              onToggle={onToggle}
              onSelect={onSelect}
              onRequestCreateChild={onRequestCreateChild}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))}

          {node.recordings.map((recording) => (
            <li key={recording.id}>
              <button
                type="button"
                className={
                  recording.id === selectedId ? 'tree__item tree__item--selected' : 'tree__item'
                }
                style={{ paddingLeft: `${22 + depth * 14}px` }}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(RECORDING_MIME, recording.id)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onClick={() => onSelect(recording.id)}
                title={recording.title}
              >
                <span className="tree__title">{recording.title}</span>
                <span className={`badge badge--${recording.status}`}>
                  {STATUS_LABELS[recording.status] ?? recording.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** 行に出す件数。フォルダを畳んだままでも中身の有無が分かるようにする。 */
const countRecordings = (node: LibraryNode): number =>
  node.recordings.length + node.children.reduce((total, child) => total + countRecordings(child), 0)
