import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dismissToast,
  expireToasts,
  nextExpiry,
  pauseToast,
  pushToast,
  resumeToast,
  type ToastTone,
  type TransientToast
} from '../toasts'

export interface Toasts {
  readonly items: readonly TransientToast[]
  notify(toast: { readonly tone: ToastTone; readonly text: string }): void
  dismiss(id: number): void
  pause(id: number): void
  resume(id: number): void
}

/**
 * 時間で消えるトーストの置き場。規則は toasts.ts の純粋関数が持ち、ここは時刻とタイマーだけを扱う。
 * トーストごとにタイマーを持つと、止める・延ばすのたびに張り直しが要るので、最も早い期限に 1 本だけ張る。
 */
export const useToasts = (): Toasts => {
  const [items, setItems] = useState<readonly TransientToast[]>([])
  const nextId = useRef(1)

  useEffect(() => {
    const at = nextExpiry(items)
    if (at === undefined) return
    const timer = window.setTimeout(
      () => setItems((queue) => expireToasts(queue, Date.now())),
      Math.max(0, at - Date.now())
    )
    return () => window.clearTimeout(timer)
  }, [items])

  const notify = useCallback((toast: { readonly tone: ToastTone; readonly text: string }): void => {
    const id = nextId.current
    nextId.current += 1
    setItems((queue) => pushToast(queue, toast, Date.now(), id))
  }, [])

  const dismiss = useCallback((id: number): void => setItems((queue) => dismissToast(queue, id)), [])
  const pause = useCallback((id: number): void => setItems((queue) => pauseToast(queue, id, Date.now())), [])
  const resume = useCallback((id: number): void => setItems((queue) => resumeToast(queue, id, Date.now())), [])

  return { items, notify, dismiss, pause, resume }
}
