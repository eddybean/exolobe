import { useEffect, type RefObject } from 'react'

/** モーダル内でフォーカスを回す対象。この画面にあるのは入力・ボタン・リンクだけ。 */
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), a[href]'

/**
 * モーダルの Escape 閉じと、Tab のフォーカス閉じ込め。
 *
 * `aria-modal` を名乗る以上、Tab で背後の画面へ抜けさせてはいけない。
 * 閉じ込めの手順はモーダルごとに変わらないので、ここに 1 つだけ置く。
 */
export const useModalKeys = (
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void
): void => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || panelRef.current === null) return

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (first === undefined || last === undefined) return

      // 消えた行のボタンにフォーカスがあった等でパネルの外へ落ちていたら、
      // 素通りさせずに引き戻す。落ちたままだと Tab が背後の画面へ進む。
      if (!panelRef.current.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
        return
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, panelRef])
}
