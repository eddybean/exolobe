import type { ReactElement } from 'react'
import type { TranscriptHitDto } from '@shared/ipc'
import { formatDateTime, formatDuration } from '../format'
import { splitHighlight } from '../library/transcriptSearch'

export type TranscriptSearchState =
  | { readonly kind: 'searching' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'done'; readonly hits: readonly TranscriptHitDto[] }

/**
 * 文字起こし本文に当たった発言の一覧。
 *
 * タイトル・要約の絞り込み（ツリー）とは当たる場所が違うので、混ぜずに下へ並べる。
 * 当たった語をハイライトした抜粋を添え、開く前になぜ当たったのかを見せる。
 */
export const TranscriptSearchResults = ({
  state,
  selected,
  onSelect
}: {
  state: TranscriptSearchState
  /** いま開いている発言。同じ録音の別の発言と見分けるため時刻まで見る。 */
  selected: { recordingId: string; startMs: number } | undefined
  onSelect: (recordingId: string, startMs: number) => void
}): ReactElement | null => {
  if (state.kind === 'searching') return <p className="transcript-hits__note">本文を検索中…</p>
  if (state.kind === 'error') {
    return (
      <p className="transcript-hits__note" role="alert">
        {state.message}
      </p>
    )
  }
  if (state.hits.length === 0) return null

  return (
    <section className="transcript-hits">
      <h3 className="transcript-hits__heading">本文に一致（{state.hits.length} 件）</h3>
      <ul className="transcript-hits__list">
        {state.hits.map((hit) => {
          const active =
            selected?.recordingId === hit.recordingId && selected.startMs === hit.startMs
          return (
            <li key={`${hit.recordingId}-${hit.startMs}`}>
              <button
                type="button"
                className={active ? 'transcript-hit transcript-hit--selected' : 'transcript-hit'}
                onClick={() => onSelect(hit.recordingId, hit.startMs)}
                title={hit.title}
              >
                <span className="transcript-hit__title">{hit.title}</span>
                <span className="transcript-hit__meta">
                  {formatDateTime(hit.startedAt)} ・ {formatDuration(hit.startMs)} ・{' '}
                  {hit.speakerLabel}
                </span>
                <span className="transcript-hit__excerpt">
                  {splitHighlight(hit.excerpt, hit.ranges).map((piece, index) =>
                    piece.hit ? (
                      <mark key={index}>{piece.text}</mark>
                    ) : (
                      <span key={index}>{piece.text}</span>
                    )
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
