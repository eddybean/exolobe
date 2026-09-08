import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { isCommitEnter } from '../keyboard'

/**
 * クリックすると編集できるタイトル。
 *
 * 別途「編集」ボタンを置くより、見出しそのものを押せる方が迷いにくい。
 * Enter で確定、Escape で取り消し、フォーカスが外れたら確定する。
 * ただし日本語入力の変換確定の Enter は確定として扱わない（isCommitEnter）。
 * 空のまま確定しようとした場合は元の値へ戻す（タイトルの無い録音を作らない）。
 */
export const EditableTitle = ({
  value,
  onCommit
}: {
  value: string
  onCommit: (title: string) => Promise<void>
}): ReactElement => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 別の録音に切り替わったら編集中の内容を持ち越さない。
  useEffect(() => {
    setDraft(value)
    setEditing(false)
  }, [value])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const commit = useCallback(async (): Promise<void> => {
    const title = draft.trim()

    if (!title || title === value) {
      setDraft(value)
      setEditing(false)
      return
    }

    setSaving(true)
    try {
      await onCommit(title)
      setEditing(false)
    } catch {
      // 失敗の理由は呼び出し側が表示するので、ここでは編集状態を保って
      // 入力し直せるようにする。
      setSaving(false)
      return
    }
    setSaving(false)
  }, [draft, value, onCommit])

  const cancel = useCallback((): void => {
    setDraft(value)
    setEditing(false)
  }, [value])

  if (!editing) {
    return (
      <h2 className="detail__title">
        <button
          type="button"
          className="detail__title-button"
          onClick={() => setEditing(true)}
          title="クリックしてタイトルを変更"
        >
          {value}
          <span className="detail__title-hint" aria-hidden="true">
            ✎
          </span>
        </button>
      </h2>
    )
  }

  return (
    <h2 className="detail__title">
      <input
        ref={inputRef}
        className="detail__title-input"
        value={draft}
        disabled={saving}
        aria-label="タイトル"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (isCommitEnter(event)) {
            event.preventDefault()
            void commit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
        }}
      />
    </h2>
  )
}
