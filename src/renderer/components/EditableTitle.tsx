import type { ReactElement } from 'react'
import { useInlineEdit } from '../hooks/useInlineEdit'

/**
 * クリックすると編集できるタイトル。
 * 確定・取り消し・失敗時の振る舞いは useInlineEdit が持つ。
 */
export const EditableTitle = ({
  value,
  onCommit
}: {
  value: string
  onCommit: (title: string) => Promise<void>
}): ReactElement => {
  const { editing, draft, saving, inputRef, setDraft, start, commit, onKeyDown } = useInlineEdit(
    value,
    onCommit
  )

  if (!editing) {
    return (
      <h2 className="detail__title">
        <button
          type="button"
          className="detail__title-button"
          onClick={start}
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
        readOnly={saving}
        aria-label="タイトル"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    </h2>
  )
}
