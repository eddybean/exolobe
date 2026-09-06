import { useMemo, useState, type ReactElement } from 'react'
import type { RecordingDto } from '@shared/ipc'
import { STATUS_LABELS, formatDateTime, formatDuration } from '../format'

/** 一覧。日付降順で、タイトル・要約プレビュー・処理状態を一目で分かるようにする。 */
export const RecordingListView = ({
  recordings,
  selectedId,
  onSelect
}: {
  recordings: readonly RecordingDto[]
  selectedId: string | undefined
  onSelect: (id: string) => void
}): ReactElement => {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return recordings

    return recordings.filter((recording) =>
      [recording.title, recording.summaryPreview ?? ''].some((text) =>
        text.toLowerCase().includes(needle)
      )
    )
  }, [recordings, query])

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
            <li key={recording.id}>
              <button
                type="button"
                className={
                  recording.id === selectedId ? 'card card--selected' : 'card'
                }
                onClick={() => onSelect(recording.id)}
              >
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
