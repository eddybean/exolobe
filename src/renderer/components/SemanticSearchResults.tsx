import type { ReactElement } from 'react'
import type { SearchHitDto } from '@shared/ipc'
import { formatDateTime } from '../format'
import { libraryListText } from '../i18n/libraryList'
import { hitLocation } from '../library/semanticSearch'

export type SemanticSearchState =
  | { readonly kind: 'searching' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'done'; readonly hits: readonly SearchHitDto[] }

/**
 * 意味検索の結果。関連度の高い順に並べる。
 *
 * フォルダのツリーに混ぜず一覧で出すのは、順位そのものが情報だから。
 * 当たった箇所の抜粋を添え、なぜ当たったのかを開かずに確かめられるようにする。
 */
export const SemanticSearchResults = ({
  state,
  selectedId,
  onSelect
}: {
  state: SemanticSearchState
  selectedId: string | undefined
  onSelect: (id: string) => void
}): ReactElement => {
  const t = libraryListText()
  if (state.kind === 'searching') {
    return <p className="tree__empty">{t.semanticSearching}</p>
  }
  if (state.kind === 'error') {
    return (
      <p className="tree__empty" role="alert">
        {state.message}
      </p>
    )
  }
  if (state.hits.length === 0) {
    return <p className="tree__empty">{t.semanticNoHits}</p>
  }

  return (
    <ul className="tree__list">
      {state.hits.map((hit) => (
        <li key={hit.recordingId}>
          <button
            type="button"
            className={hit.recordingId === selectedId ? 'semantic__hit semantic__hit--selected' : 'semantic__hit'}
            onClick={() => onSelect(hit.recordingId)}
            title={hit.title}
          >
            <span className="semantic__title">{hit.title}</span>
            <span className="semantic__meta">{t.joinMeta(formatDateTime(hit.startedAt), hitLocation(hit))}</span>
            {hit.excerpt && <span className="semantic__excerpt">{hit.excerpt}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}
