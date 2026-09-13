import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { SearchIndexStatusDto } from '@shared/ipc'
import { messageOf } from '../errorMessage'
import { searchIndexSummary } from '../library/semanticSearch'

/**
 * 意味検索の有効・無効と、索引の状態・削除。
 *
 * 索引は録音 1 時間あたり数百 KB と小さいが、件数に比例して増える。
 * 使っている容量を見せ、要らなければ利用者の判断で消せるようにする。
 * 無効にすれば自動で消える（main 側で処理する）。
 */
export const SemanticSearchSettings = ({
  enabled,
  onToggle
}: {
  enabled: boolean
  onToggle: (enabled: boolean) => void
}): ReactElement => {
  const [status, setStatus] = useState<SearchIndexStatusDto>()
  const [error, setError] = useState<string>()
  const [clearing, setClearing] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setStatus(await window.recorder.getSearchIndexStatus())
  }, [])

  useEffect(() => {
    void refresh()
    // 同期の進み具合が変わるたびに件数と容量も変わるので、状態ごと取り直す。
    return window.recorder.onSearchIndexChanged(() => void refresh())
  }, [refresh, enabled])

  const clear = async (): Promise<void> => {
    setError(undefined)
    if (!(await window.recorder.confirmClearSearchIndex())) return

    setClearing(true)
    try {
      setStatus(await window.recorder.clearSearchIndex())
    } catch (clearError: unknown) {
      setError(messageOf(clearError))
    } finally {
      setClearing(false)
    }
  }

  const hasIndex = status !== undefined && (status.indexedCount > 0 || status.bytes > 0)

  return (
    <>
      <label className="field">
        <span className="field__label">意味検索を使う</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span className="field__hint">
          「天気の話をした会議」のような文章で録音を探せるようにします。文字起こし・要約・メモを
          この Mac の中でベクトル化して検索します。無効にするとインデックスは削除されます。
        </span>
      </label>

      <div className="field">
        <span className="field__label">インデックス</span>
        <div className="settings__path">
          <span className="semantic__status">
            {status === undefined
              ? '確認中…'
              : status.enabled
                ? searchIndexSummary(status)
                : hasIndex
                  ? `無効（${status.indexedCount} 件分が残っています）`
                  : '無効'}
          </span>
          <button type="button" disabled={!hasIndex || clearing} onClick={() => void clear()}>
            {clearing ? '削除中…' : 'インデックスを削除'}
          </button>
        </div>
        <span className="field__hint">
          削除しても録音・文字起こし・要約・メモは消えません。意味検索が有効な間は、次に録音を処理したときなどに作り直されます。
        </span>
        {error && (
          <span className="settings__error" role="alert">
            {error}
          </span>
        )}
      </div>
    </>
  )
}
