import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { VoiceprintDto } from '@shared/ipc'
import { messageOf } from '../errorMessage'
import { voiceprintSummary } from '../library/voiceprints'

/**
 * 覚えた声の一覧と削除。
 *
 * 自動で名前が入る以上、「なぜこの名前が出たのか」を利用者が確かめて取り消せる
 * 必要がある。覚え違いをその場で消せなければ、間違った名前が毎回入り続ける。
 */
export const VoiceprintSettings = ({
  enabled,
  storageDir
}: {
  enabled: boolean
  /** 声紋帳は保存先ルートに置くので、保存先が決まるまでは読みにいけない。 */
  storageDir: string | null
}): ReactElement => {
  const [entries, setEntries] = useState<VoiceprintDto[]>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setEntries(await window.recorder.listVoiceprints())
    } catch (listError: unknown) {
      // 読めなかったことを表に出す。黙って「確認中…」のまま止まると、
      // 覚えた声が無いのか読めていないのかが利用者から区別できない。
      setEntries([])
      setError(messageOf(listError))
    }
  }, [])

  useEffect(() => {
    if (storageDir === null) return
    void refresh()
  }, [refresh, storageDir])

  const run = async (action: () => Promise<VoiceprintDto[]>): Promise<void> => {
    setError(undefined)
    setBusy(true)
    try {
      setEntries(await action())
    } catch (actionError: unknown) {
      setError(messageOf(actionError))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (name: string): Promise<void> => {
    if (!(await window.recorder.confirmRemoveVoiceprint(name))) return
    await run(() => window.recorder.removeVoiceprint(name))
  }

  const clear = async (): Promise<void> => {
    if (!(await window.recorder.confirmClearVoiceprints())) return
    await run(() => window.recorder.clearVoiceprints())
  }

  return (
    <div className="field">
      <span className="field__label">覚えた声</span>

      {storageDir === null ? (
        <span className="voiceprints__empty">保存先を選ぶと、覚えた声をここに一覧します。</span>
      ) : entries === undefined ? (
        <span className="voiceprints__empty">確認中…</span>
      ) : entries.length === 0 ? (
        <span className="voiceprints__empty">
          まだありません。録音の詳細画面で話者に名前を付けると、その声を覚えます。
        </span>
      ) : (
        <ul className="voiceprints">
          {entries.map((entry) => (
            <li key={entry.name} className="voiceprints__item">
              <span className="voiceprints__name">{entry.name}</span>
              <span className="voiceprints__meta">{voiceprintSummary(entry)}</span>
              <button type="button" disabled={busy} onClick={() => void remove(entry.name)}>
                忘れる
              </button>
            </li>
          ))}
        </ul>
      )}

      {entries !== undefined && entries.length > 0 && (
        <div className="settings__path">
          <button type="button" disabled={busy} onClick={() => void clear()}>
            すべて忘れる
          </button>
        </div>
      )}

      <span className="field__hint">
        {enabled
          ? '次の録音で同じ声が出てきたら、この名前を自動で当てはめます。違っていたら詳細画面で付け直してください。付け直した名前をそのまま覚え直します。'
          : '話者識別が無効なので、いまは自動で当てはめません。覚えた声はそのまま残ります。'}
      </span>

      {error && (
        <span className="settings__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
