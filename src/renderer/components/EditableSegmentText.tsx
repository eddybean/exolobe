import type { ReactElement } from 'react'
import { useInlineEdit } from '../hooks/useInlineEdit'
import { editableText } from '../i18n/editable'
import { shouldStartEditOnTextClick, splitTrailingChar } from '../segmentEdit'
import { PenIcon } from './PenIcon'

/**
 * 文字起こしの 1 発言の本文。本文か、末尾のペンを押すとその場で書き換えられる。
 *
 * 本文は選んでコピーされることが多いので、範囲を選び終えたときの click では
 * 編集に入らない。キーボードではペンのボタンに辿り着いて押す。
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
  const t = editableText().segmentText

  if (!editing) {
    const [head, tail] = splitTrailingChar(text)
    const editable = blocker === undefined
    return (
      <div className="segment__body">
        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- 本文の click はマウスの近道。キーボードでは末尾のペンのボタンで同じことができる */}
        <p
          className={editable ? 'segment__text segment__text--editable' : 'segment__text'}
          onClick={() => {
            if (editable && shouldStartEditOnTextClick(window.getSelection()?.toString() ?? '')) {
              start()
            }
          }}
        >
          {head}
          <span className="segment__text-tail">
            {tail}
            <button
              type="button"
              className="segment__edit"
              onClick={(event) => {
                // 本文の click にも届くと、選択の判定を経て二度始めてしまう。
                event.stopPropagation()
                start()
              }}
              disabled={!editable}
              title={blocker ?? t.editHint}
              aria-label={t.edit}
            >
              <PenIcon />
            </button>
          </span>
        </p>
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
        aria-label={t.ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <p className="segment__edit-hint">{t.keyHint}</p>
    </div>
  )
}
