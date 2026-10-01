import { useId, type ReactElement } from 'react'
import { useInlineEdit } from '../hooks/useInlineEdit'
import { editableText } from '../i18n/editable'

/**
 * 文字起こしの行頭に出る話者名。クリックするとその場で書き換えられる。
 *
 * 以前は window.prompt を開いていたが、Electron の renderer では prompt が
 * 使えず、押しても何も起きなかった。タイトルと同じインライン編集に揃える。
 *
 * 名前は話者ごとに持つので、同じ話者の行はまとめて変わる。
 *
 * 候補（予定の参加者・声紋帳の名前）は datalist で入力を補うだけで、自由に打てることは変えない。
 */
export const EditableSpeaker = ({
  label,
  tone,
  suggestions = [],
  onCommit
}: {
  label: string
  /** タイムラインの帯と同じ色の番号。無ければ色を付けない。 */
  tone?: number | undefined
  suggestions?: readonly string[] | undefined
  onCommit: (label: string) => Promise<void>
}): ReactElement => {
  const { editing, draft, saving, inputRef, setDraft, start, commit, onKeyDown } = useInlineEdit(label, onCommit)
  const listId = useId()
  const t = editableText().speaker

  if (!editing) {
    return (
      <button
        type="button"
        className={tone === undefined ? 'segment__speaker' : `segment__speaker speaker-chip tone-${tone}`}
        onClick={start}
        title={t.hint}
      >
        {label}
      </button>
    )
  }

  return (
    <>
      <input
        ref={inputRef}
        className="segment__speaker-input"
        value={draft}
        readOnly={saving}
        aria-label={t.ariaLabel}
        list={suggestions.length > 0 ? listId : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((name) => (
            <option key={name} value={name} aria-label={name} />
          ))}
        </datalist>
      )}
    </>
  )
}
