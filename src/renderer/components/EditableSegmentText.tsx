import type { ReactElement } from 'react'
import { useInlineEdit } from '../hooks/useInlineEdit'

/**
 * 文字起こしの 1 発言の本文。「直す」を押すとその場で書き換えられる。
 *
 * 話者名と違い、本文そのものを押して編集に入る形にはしない。本文は選んで
 * コピーされることが多く、押すたびに編集欄へ変わると選べなくなる。
 *
 * Enter で確定する（本文は transcript.md で 1 行に書くので改行は入れさせない）。
 * 空にして確定すると元の本文に戻る。発言を消す操作は持たない —— 意味検索の
 * 索引がセグメントの位置を指しているため、数が変わると索引がずれる。
 */
export const EditableSegmentText = ({
  text,
  blocker,
  onCommit
}: {
  text: string
  /** 今は直せない理由。直せるなら undefined。 */
  blocker: string | undefined
  onCommit: (text: string) => Promise<void>
}): ReactElement => {
  const { editing, draft, saving, inputRef, setDraft, start, commit, onKeyDown } = useInlineEdit(
    text,
    onCommit
  )

  if (!editing) {
    return (
      <div className="segment__body">
        <p className="segment__text">{text}</p>
        <button
          type="button"
          className="segment__edit"
          onClick={start}
          disabled={blocker !== undefined}
          title={blocker ?? '音声を聞いて本文を直す'}
        >
          直す
        </button>
      </div>
    )
  }

  return (
    <div className="segment__body segment__body--editing">
      <textarea
        ref={inputRef}
        className="segment__text-input"
        value={draft}
        readOnly={saving}
        aria-label="発言の本文"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <p className="segment__edit-hint">
        Enter で保存 ・ Esc で取り消し ・ 時刻を押すと直しながら聞き直せます
      </p>
    </div>
  )
}
