import { useMemo, useState, type ReactElement } from 'react'
import type { RecordingDto } from '@shared/ipc'
import { STATUS_LABELS, formatDateTime, formatDuration } from '../format'

/** 一覧。日付降順で、タイトル・要約プレビュー・処理状態を一目で分かるようにする。 */
export const RecordingListView = ({
  recordings,
  selectedId,
  selectedFolderId,
  onSelect,
  onDelete
}: {
  recordings: readonly RecordingDto[]
  selectedId: string | undefined
  /** サイドバーで選ばれているフォルダ。'all' は絞り込みなし、'unfiled' は未分類のみ。 */
  selectedFolderId: 'all' | 'unfiled' | string
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}): ReactElement => {
  const [query, setQuery] = useState('')

  const byFolder = useMemo(() => {
    if (selectedFolderId === 'all') return recordings
    if (selectedFolderId === 'unfiled') {
      return recordings.filter((recording) => recording.folderId === undefined)
    }
    return recordings.filter((recording) => recording.folderId === selectedFolderId)
  }, [recordings, selectedFolderId])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return byFolder

    return byFolder.filter((recording) =>
      [recording.title, recording.summaryPreview ?? ''].some((text) =>
        text.toLowerCase().includes(needle)
      )
    )
  }, [byFolder, query])

  return (
    <section className="list">
      <header className="list__header">
        <h2>録音一覧</h2>
        <input
          type="search"
          className="list__search"
          placeholder="タイトル・要約で絞り込む"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>

      {filtered.length === 0 ? (
        <p className="list__empty">
          {recordings.length === 0
            ? '録音はまだありません。下の「録音」ボタンで開始できます。'
            : '一致する録音がありません。'}
        </p>
      ) : (
        <ul className="list__items">
          {filtered.map((recording) => (
            <li
              key={recording.id}
              className={recording.id === selectedId ? 'row row--selected' : 'row'}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-recording-id', recording.id)
                event.dataTransfer.effectAllowed = 'move'
              }}
            >
              <button type="button" className="card" onClick={() => onSelect(recording.id)}>
                <div className="card__row">
                  <span className="card__title">{recording.title}</span>
                  <StatusBadge status={recording.status} />
                </div>
                <div className="card__meta">
                  <span>{formatDateTime(recording.startedAt)}</span>
                  {recording.durationMs > 0 && <span>{formatDuration(recording.durationMs)}</span>}
                </div>
                {recording.summaryPreview && (
                  <p className="card__preview">{recording.summaryPreview}</p>
                )}
              </button>

              {/* 選択中とホバー時だけ出す。一覧を眺めているときに誤って押させないため。 */}
              <button
                type="button"
                className="row__delete"
                onClick={() => onDelete(recording.id)}
                title={`「${recording.title}」を削除`}
                aria-label={`「${recording.title}」を削除`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const StatusBadge = ({ status }: { status: string }): ReactElement => (
  <span className={`badge badge--${status}`}>{STATUS_LABELS[status] ?? status}</span>
)
