import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { isCommitEnter } from '../keyboard'

export interface InlineEdit {
  readonly editing: boolean
  readonly draft: string
  /**
   * 保存中。input の `readOnly` に渡す。
   *
   * `disabled` は使わない。フォーカス中の要素を disabled にすると HTML の
   * 仕様どおりブラウザが blur を起こし、onBlur に繋いだ確定がもう一度走って
   * 同じ保存を二重に投げてしまう（Enter で確定した直後がまさにこれ）。
   */
  readonly saving: boolean
  /**
   * input の ref に渡す。入力欄は編集中しか描かれないので、繋がった瞬間＝
   * 編集開始。そこで選択済みのフォーカスを当てる。
   */
  readonly inputRef: (node: HTMLInputElement | null) => void
  readonly setDraft: (value: string) => void
  readonly start: () => void
  readonly commit: () => void
  readonly cancel: () => void
  /** Enter で確定、Escape で取り消し。input の onKeyDown にそのまま渡す。 */
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}

/**
 * その場で書き換えられるテキストの共通の振る舞い。
 *
 * 別途「編集」ボタンを置くより、値そのものを押せる方が迷いにくい。
 * Enter で確定、Escape で取り消し、フォーカスが外れたら確定する。
 * ただし日本語入力の変換確定の Enter は確定として扱わない（isCommitEnter）。
 * 空のまま確定しようとした場合は元の値へ戻す（名前の無いものを作らない）。
 *
 * 保存に失敗したときは編集状態を保つ。理由の表示は呼び出し側の仕事で、
 * ここは入力し直せる状態を残すことだけを引き受ける。
 */
export const useInlineEdit = (
  value: string,
  onCommit: (next: string) => Promise<void>
): InlineEdit => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  // 確定は Enter・blur・二度押しと複数の経路から来る。state の更新を待たずに
  // 弾けるよう、実行中かどうかは ref で持つ。
  const inFlight = useRef(false)

  // 表示中の対象が入れ替わったら編集中の内容を持ち越さない。
  useEffect(() => {
    setDraft(value)
    setEditing(false)
  }, [value])

  const inputRef = useCallback((node: HTMLInputElement | null): void => {
    node?.focus()
    node?.select()
  }, [])

  const commit = useCallback((): void => {
    if (inFlight.current) return

    const next = draft.trim()

    if (!next || next === value) {
      setDraft(value)
      setEditing(false)
      return
    }

    inFlight.current = true
    setSaving(true)
    onCommit(next)
      .then(() => setEditing(false))
      .catch(() => {
        // 失敗の理由は呼び出し側が表示する。ここは編集状態を保って入力し直せるようにする。
      })
      .finally(() => {
        inFlight.current = false
        setSaving(false)
      })
  }, [draft, value, onCommit])

  const cancel = useCallback((): void => {
    setDraft(value)
    setEditing(false)
  }, [value])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (isCommitEnter(event)) {
        event.preventDefault()
        commit()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    },
    [commit, cancel]
  )

  return {
    editing,
    draft,
    saving,
    inputRef,
    setDraft,
    start: () => setEditing(true),
    commit,
    cancel,
    onKeyDown
  }
}
