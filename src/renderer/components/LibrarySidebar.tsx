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
import {
  filterByQuery,
  folderChipRows,
  folderPathLabel,
  recordingsInFolder,
  resolveFolderKey,
  type FolderChip,
  type FolderKey
} from '../library/folders'
import { STATUS_LABELS } from '../format'
import { useNow } from '../hooks/useNow'
import { groupByDate, recordingRowMeta } from '../library/rows'
import { SemanticSearchResults, type SemanticSearchState } from './SemanticSearchResults'
import {
  TranscriptSearchResults,
  type TranscriptSearchState
} from './TranscriptSearchResults'

/** 本文の検索を走らせるまでの待ち。打っている途中の語で全件を読まないための間。 */
const TRANSCRIPT_SEARCH_DEBOUNCE_MS = 250

/**
 * フォルダ名を入力させるモーダル。
 *
 * window.prompt() は Electron のレンダラーでは実装されておらず、呼んでも
 * 即座に null が返るだけで何も表示されないため使わない。
 */
const FolderNameModal = ({
  title,
  initialName,
  submitLabel,
  onCommit,
  onCancel
}: {
  title: string
  initialName: string
  submitLabel: string
  onCommit: (name: string) => void
  onCancel: () => void
}): ReactElement => {
  const [draft, setDraft] = useState(initialName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // 名前の変更では今の名前を選んでおき、打てばそのまま置き換わるようにする。
    inputRef.current?.select()
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
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * ライブラリ。上にフォルダを並べて選び、下にそのフォルダの録音を日付で区切って出す。
 *
 * 以前はフォルダと録音を 1 本のツリーに入れ子で出していたが、フォルダを開くたびに
 * 録音が間に挟まって縦に伸び、目当てのフォルダまで遠かった。ボタンの列では親子を
 * 表せないので、選んだフォルダに子があれば子の列を 1 段ずつ足す（folderChipRows）。
 * 録音行をフォルダのボタンへドロップすると移し、フォルダのボタン同士では親子を入れ替える。
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
  semanticAvailable,
  folderKey,
  onSelectFolder,
  onSelectSegment,
  focus
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
  /**
   * 選んでいるフォルダ。画面遷移でこのコンポーネントは消えるので、
   * 状態は App が持つ（消えると「すべて」に戻ってしまう）。
   */
  folderKey: FolderKey
  onSelectFolder: (key: FolderKey) => void
  /** 本文のヒットから開く。詳細画面はその発言まで送られる。 */
  onSelectSegment: (recordingId: string, startMs: number) => void
  /** いま開いている発言。本文のヒットの選択表示に使う。 */
  focus: { recordingId: string; startMs: number } | undefined
}): ReactElement => {
  const now = useNow()
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'keyword' | 'semantic'>('keyword')
  const [semantic, setSemantic] = useState<SemanticSearchState | undefined>()
  const [transcriptHits, setTranscriptHits] = useState<TranscriptSearchState | undefined>()
  // 設定で無効にされたら、選んでいたモードに関わらずキーワードに戻す。
  const semanticMode = semanticAvailable && mode === 'semantic'
  const [dropTarget, setDropTarget] = useState<string | undefined>()
  const [modal, setModal] = useState<FolderModal | undefined>()

  // 選んでいたフォルダが消えていたら「すべて」を見せる。
  const currentKey = resolveFolderKey(folders, folderKey)
  const selectedFolder = folders.find((folder) => folder.id === currentKey)

  // 意味検索のモードでは語句の絞り込みをしない。Enter を押すまで一覧は全件のまま。
  const keywordQuery = semanticMode ? '' : query
  const searching = keywordQuery.trim().length > 0
  const chipRows = useMemo(
    () => folderChipRows(folders, recordings, currentKey),
    [folders, recordings, currentKey]
  )
  // 検索中はフォルダを横断する。選んだフォルダの外にある録音を「無い」と見せない。
  const listed = useMemo(
    () =>
      searching
        ? filterByQuery(recordings, keywordQuery)
        : recordingsInFolder(folders, recordings, currentKey),
    [folders, recordings, currentKey, searching, keywordQuery]
  )

  /**
   * 本文の検索。1 文字ごとに全件の transcript.json を読むのは重いので少し待つ。
   * 待つのはファイルを読む回数を減らすためで、意味検索のような確定操作は要らない。
   */
  const latestTranscriptSearch = useRef(0)
  useEffect(() => {
    const text = keywordQuery.trim()
    const ticket = latestTranscriptSearch.current + 1
    latestTranscriptSearch.current = ticket
    if (!text) {
      setTranscriptHits(undefined)
      return
    }

    const timer = setTimeout(() => {
      setTranscriptHits({ kind: 'searching' })
      window.recorder
        .searchTranscripts(text)
        .then((hits) => {
          if (latestTranscriptSearch.current === ticket) setTranscriptHits({ kind: 'done', hits })
        })
        .catch((error: unknown) => {
          if (latestTranscriptSearch.current !== ticket) return
          setTranscriptHits({ kind: 'error', message: messageOf(error) })
        })
    }, TRANSCRIPT_SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [keywordQuery])

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

  const hasTranscriptHits =
    transcriptHits !== undefined &&
    (transcriptHits.kind !== 'done' || transcriptHits.hits.length > 0)

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
              onClick={() => setModal({ kind: 'create' })}
            >
              ＋
            </button>
          </span>
        </div>
        <input
          type="search"
          className="tree__search"
          placeholder={
            semanticMode ? '例: 天気の話をした会議（Enter で検索）' : 'タイトル・要約・本文で絞り込む'
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

      {!showSemanticResults && !searching && (
        <div className="folders" aria-label="フォルダ">
          {chipRows.map((row, depth) => (
            // 段が深いほど下げ、どの段がどの段の子なのかを字下げで見せる。
            <div key={depth} className="folders__row" style={{ paddingLeft: `${depth * 14}px` }}>
              {row.map((chip) => (
                <FolderChipButton
                  key={chip.key}
                  chip={chip}
                  selected={chip.key === currentKey}
                  dropping={dropTarget === chip.key}
                  onSelect={() => onSelectFolder(chip.key)}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDropTarget(chip.key)
                  }}
                  onDragLeave={() => setDropTarget(undefined)}
                  onDrop={(event) =>
                    handleDrop(event, chip.kind === 'folder' ? chip.key : undefined)
                  }
                />
              ))}
            </div>
          ))}

          {selectedFolder && (
            <div className="folders__actions">
              <button type="button" onClick={() => setModal({ kind: 'create', parentId: selectedFolder.id })}>
                子フォルダを作成
              </button>
              <button type="button" onClick={() => setModal({ kind: 'rename', folder: selectedFolder })}>
                名前を変更
              </button>
              <button
                type="button"
                className="folders__delete"
                onClick={() => onDeleteFolder(selectedFolder.id)}
              >
                削除
              </button>
            </div>
          )}
        </div>
      )}

      {!showSemanticResults && searching && (
        <p className="folders__searching">すべてのフォルダから探しています</p>
      )}

      {!showSemanticResults && listed.length === 0 && !hasTranscriptHits && (
        <p className="tree__empty">
          {recordings.length === 0 ? (
            <>
              録音はまだありません。下の「録音」ボタンで開始するか、
              <button type="button" className="tree__empty-link" onClick={onImport}>
                音声ファイルを取り込め
              </button>
              ます。
            </>
          ) : searching ? (
            '一致する録音がありません。'
          ) : (
            'このフォルダに録音はありません。録音を上のフォルダへドラッグすると移せます。'
          )}
        </p>
      )}

      {/*
        意味検索の結果を出している間は一覧を出さない。hidden 属性では
        `.tree__list` の display 指定に負けて消えないので、描画ごと分ける。
      */}
      {!showSemanticResults && listed.length > 0 && (
        <ul className="tree__list">
          {groupByDate(listed, now).map((group) => [
            <li key={`group:${group.label}`} className="tree__group" aria-hidden="true">
              {group.label}
            </li>,
            ...group.recordings.map((recording) => (
              <li key={recording.id}>
                <RecordingRow
                  recording={recording}
                  selected={recording.id === selectedId}
                  meta={
                    searching
                      ? `${recordingRowMeta(recording, now)} ・ ${folderPathLabel(folders, recording.folderId)}`
                      : recordingRowMeta(recording, now)
                  }
                  onSelect={onSelect}
                />
              </li>
            ))
          ])}
        </ul>
      )}

      {!showSemanticResults && transcriptHits && (
        <TranscriptSearchResults
          state={transcriptHits}
          selected={focus}
          onSelect={onSelectSegment}
        />
      )}

      {modal && (
        <FolderNameModal
          title={
            modal.kind === 'rename'
              ? 'フォルダの名前を変更'
              : modal.parentId
                ? '子フォルダを作成'
                : '新規フォルダ'
          }
          initialName={modal.kind === 'rename' ? modal.folder.name : ''}
          submitLabel={modal.kind === 'rename' ? '変更' : '作成'}
          onCommit={(name) => {
            if (modal.kind === 'rename') {
              if (name !== modal.folder.name) onRenameFolder(modal.folder.id, name)
            } else {
              onCreateFolder(modal.parentId === undefined ? { name } : { name, parentId: modal.parentId })
            }
            setModal(undefined)
          }}
          onCancel={() => setModal(undefined)}
        />
      )}
    </nav>
  )
}

type FolderModal =
  | { kind: 'create'; parentId?: string }
  | { kind: 'rename'; folder: FolderDto }

/**
 * フォルダのボタン。録音やフォルダのドロップ先も兼ねる。
 * 「すべて」はドロップされても行き先が決まらないので受け付けない。
 */
const FolderChipButton = ({
  chip,
  selected,
  dropping,
  onSelect,
  onDragOver,
  onDragLeave,
  onDrop
}: {
  chip: FolderChip
  selected: boolean
  dropping: boolean
  onSelect: () => void
  onDragOver: (event: DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent) => void
}): ReactElement => {
  const className = [
    'folder-chip',
    selected ? 'folder-chip--selected' : chip.onPath ? 'folder-chip--path' : '',
    dropping ? 'folder-chip--drop' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      aria-pressed={selected}
      onClick={onSelect}
      draggable={chip.kind === 'folder'}
      onDragStart={(event) => {
        event.dataTransfer.setData(FOLDER_MIME, chip.key)
        event.dataTransfer.effectAllowed = 'move'
      }}
      {...(chip.kind === 'all' ? {} : { onDragOver, onDragLeave, onDrop })}
    >
      <span className="folder-chip__name">{chip.name}</span>
      <span className="folder-chip__count">{chip.count}</span>
    </button>
  )
}

const RecordingRow = ({
  recording,
  selected,
  meta,
  onSelect
}: {
  recording: RecordingDto
  selected: boolean
  meta: string
  onSelect: (id: string) => void
}): ReactElement => (
  <button
    type="button"
    className={selected ? 'tree__item tree__item--selected' : 'tree__item'}
    draggable
    onDragStart={(event) => {
      event.dataTransfer.setData(RECORDING_MIME, recording.id)
      event.dataTransfer.effectAllowed = 'move'
    }}
    onClick={() => onSelect(recording.id)}
    title={recording.title}
  >
    <span className="tree__item-line">
      <span className="tree__title">{recording.title}</span>
      {/* 完了は大半の行の状態で、並べても何も語らない。手が要る状態だけ出す。 */}
      {recording.status !== 'ready' && (
        <span className={`badge badge--${recording.status}`}>
          {STATUS_LABELS[recording.status] ?? recording.status}
        </span>
      )}
    </span>
    <span className="tree__meta">{meta}</span>
  </button>
)
