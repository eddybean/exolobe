import type { ReactElement } from 'react'
import { useInlineEdit } from '../hooks/useInlineEdit'

/**
 * 文字起こしの行頭に出る話者名。クリックするとその場で書き換えられる。
 *
 * 以前は window.prompt を開いていたが、Electron の renderer では prompt が
 * 使えず、押しても何も起きなかった。タイトルと同じインライン編集に揃える。
 *
 * 名前は話者ごとに持つので、同じ話者の行はまとめて変わる。
 */
export const EditableSpeaker = ({
  label,
  onCommit
}: {
  label: string
  onCommit: (label: string) => Promise<void>
}): ReactElement => {
  const { editing, draft, saving, inputRef, setDraft, start, commit, onKeyDown } = useInlineEdit(
    label,
    onCommit
  )

  if (!editing) {
    return (
      <button
        type="button"
        className="segment__speaker"
        onClick={start}
        title="クリックして話者名を変更"
      >
        {label}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      className="segment__speaker-input"
      value={draft}
      readOnly={saving}
      aria-label="話者名"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}
