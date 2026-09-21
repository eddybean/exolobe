import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { VoiceprintDto } from '@shared/ipc'
import { messageOf } from '../errorMessage'
import { useModalKeys } from '../hooks/useModalKeys'
import {
  filterVoiceprints,
  voiceprintCountLabel,
  voiceprintSummary
} from '../library/voiceprints'

/**
 * 覚えた声の一覧と削除。
 *
 * 自動で名前が入る以上、「なぜこの名前が出たのか」を利用者が確かめて取り消せる
 * 必要がある。覚え違いをその場で消せなければ、間違った名前が毎回入り続ける。
 *
 * 一覧そのものは設定画面に置かずモーダルへ逃がす。声紋は人数ぶん増えつづけるので、
 * 設定画面に並べると後ろの項目（音声など）が人数に応じて遠ざかっていく。
 * 設定画面に残すのは覚えている人数だけにして、ページの高さを一定に保つ。
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
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const restoring = useRef(false)

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

  const close = useCallback((): void => {
    setOpen(false)
    restoring.current = true
  }, [])

  /**
   * 閉じたあとのフォーカスを戻す。
   *
   * 描き直しの後でないと戻し先が決まらない ―― すべて忘れた直後は「一覧を開く」
   * ごと消えるので、そのときはラベルへ逃がす。body に落ちるとキーボードだけの
   * 操作で現在地を見失う。
   */
  useEffect(() => {
    if (open || !restoring.current) return
    restoring.current = false
    ;(openerRef.current ?? labelRef.current)?.focus()
  }, [open])

  const run = async (action: () => Promise<VoiceprintDto[]>): Promise<void> => {
    setError(undefined)
    setBusy(true)
    try {
      const next = await action()
      setEntries(next)
      // 空になった一覧を見せても操作するものが無い。設定画面の案内に戻す。
      // ここで閉じないと open が true のまま残り、以後エラーを表に出せなくなる。
      if (next.length === 0) close()
    } catch (actionError: unknown) {
      setError(messageOf(actionError))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (name: string): Promise<void> => {
    if (!(await window.recorder.confirmRemoveVoiceprint(name))) return
    // 続けて消したいことがあるので、1 件消しただけでは閉じない（空になれば run が閉じる）。
    await run(() => window.recorder.removeVoiceprint(name))
  }

  const clear = async (): Promise<void> => {
    if (!(await window.recorder.confirmClearVoiceprints())) return
    await run(() => window.recorder.clearVoiceprints())
  }

  return (
    <div className="field">
      {/* tabIndex は、すべて忘れて「一覧を開く」が消えたときのフォーカスの逃がし先。 */}
      <span className="field__label" ref={labelRef} tabIndex={-1}>
        覚えた声
      </span>

      {storageDir === null ? (
        <span className="voiceprints__empty">保存先を選ぶと、覚えた声をここに一覧します。</span>
      ) : entries === undefined ? (
        <span className="voiceprints__empty">確認中…</span>
      ) : entries.length === 0 ? (
        <span className="voiceprints__empty">
          まだありません。録音の詳細画面で話者に名前を付けると、その声を覚えます。
        </span>
      ) : (
        <div className="voiceprints__summary">
          <span className="voiceprints__count">{voiceprintCountLabel(entries.length)}</span>
          <button type="button" ref={openerRef} onClick={() => setOpen(true)}>
            一覧を開く
          </button>
        </div>
      )}

      <span className="field__hint">
        {enabled
          ? '次の録音で同じ声が出てきたら、この名前を自動で当てはめます。違っていたら詳細画面で付け直してください。付け直した名前をそのまま覚え直します。'
          : '話者識別が無効なので、いまは自動で当てはめません。覚えた声はそのまま残ります。'}
      </span>

      {/* モーダルが背後を覆うので、開いている間のエラーはモーダルの中に出す。 */}
      {!open && error && (
        <span className="settings__error" role="alert">
          {error}
        </span>
      )}

      {/* 空になったら run が閉じるので、ここで件数を見張る必要はない。 */}
      {open && entries !== undefined && (
        <VoiceprintListModal
          entries={entries}
          busy={busy}
          error={error}
          onRemove={(name) => void remove(name)}
          onClearAll={() => void clear()}
          onClose={close}
        />
      )}
    </div>
  )
}

/**
 * 覚えた声の一覧そのもの。
 *
 * IPC は呼ばず、渡された配列を描いて操作を親へ返すだけにする。声紋帳を書き換える
 * 入口を VoiceprintSettings の 1 か所に保つため。
 */
const VoiceprintListModal = ({
  entries,
  busy,
  error,
  onRemove,
  onClearAll,
  onClose
}: {
  entries: readonly VoiceprintDto[]
  busy: boolean
  /** exactOptionalPropertyTypes のため省略可能にはせず、undefined を明示で受ける。 */
  error: string | undefined
  onRemove: (name: string) => void
  onClearAll: () => void
  onClose: () => void
}): ReactElement => {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const shown = filterVoiceprints(entries, query)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useModalKeys(panelRef, onClose)

  const title = `覚えた声（${entries.length} 人）`

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="modal__title">{title}</h3>

        <input
          ref={inputRef}
          className="modal__input"
          placeholder="名前で絞り込む"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {shown.length === 0 ? (
          <span className="voiceprints__empty">当てはまる名前はありません。</span>
        ) : (
          <ul className="voiceprints voiceprints--scroll">
            {shown.map((entry) => (
              <li key={entry.name} className="voiceprints__item">
                <span className="voiceprints__name">{entry.name}</span>
                <span className="voiceprints__meta">{voiceprintSummary(entry)}</span>
                <button type="button" disabled={busy} onClick={() => onRemove(entry.name)}>
                  忘れる
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <span className="settings__error" role="alert">
            {error}
          </span>
        )}

        <div className="modal__actions modal__actions--split">
          <button type="button" disabled={busy} onClick={onClearAll}>
            すべて忘れる
          </button>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
