import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatAvailabilityDto } from '@shared/ipc'
import { appendChunk, completeMessage, startTurn, toHistory, type ChatMessage } from '../chat/messages'

/**
 * 断片を溜めてから画面に反映する間隔。
 *
 * トークンごとに setState すると毎秒数十回の再描画になり、会話が伸びるほど
 * リスト全体の描き直しが重くなる。60ms なら文字が流れて見えるだけの滑らかさは保てる。
 */
const FLUSH_INTERVAL_MS = 60

export interface ChatController {
  readonly messages: readonly ChatMessage[]
  readonly pendingId: string | undefined
  readonly availability: ChatAvailabilityDto | undefined
  ask: (question: string) => void
  cancel: () => void
  reset: () => void
  refresh: () => void
}

export const useChat = (): ChatController => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pendingId, setPendingId] = useState<string>()
  const [availability, setAvailability] = useState<ChatAvailabilityDto>()

  // 断片の受け口。requestId ごとに溜めて、一定間隔でまとめて反映する。
  const buffer = useRef(new Map<string, string>())
  // 購読は張り直さない（張り直す間に届いた断片を取りこぼす）ので、
  // 最新の履歴と生成中の依頼は ref 越しに読む。描画中には触らない。
  const latest = useRef<ChatMessage[]>([])
  const pendingRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    latest.current = messages
  }, [messages])

  useEffect(() => {
    pendingRef.current = pendingId
  }, [pendingId])

  const refresh = useCallback((): void => {
    void window.recorder.getChatAvailability().then(setAvailability)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const timer = setInterval(() => {
      if (buffer.current.size === 0) return

      const pending = new Map(buffer.current)
      buffer.current.clear()
      setMessages((current) => {
        let next = current
        for (const [requestId, text] of pending) next = appendChunk(next, requestId, text)
        return next
      })
    }, FLUSH_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [])

  useEffect(
    () =>
      window.recorder.onChatChunk((event) => {
        buffer.current.set(event.requestId, (buffer.current.get(event.requestId) ?? '') + event.text)
      }),
    []
  )

  useEffect(
    () =>
      window.recorder.onChatDone((event) => {
        // 溜まっている断片は最終テキストで上書きされるので、ここで捨ててよい。
        buffer.current.delete(event.requestId)
        setMessages((current) => completeMessage(current, event))
        setPendingId((current) => (current === event.requestId ? undefined : current))
        refresh()
      }),
    [refresh]
  )

  const ask = useCallback((question: string): void => {
    const text = question.trim()
    if (text.length === 0) return

    const requestId = crypto.randomUUID()
    const history = toHistory(latest.current)

    setMessages((current) => startTurn(current, requestId, text))
    setPendingId(requestId)
    void window.recorder.askChat({ requestId, question: text, history })
  }, [])

  const cancel = useCallback((): void => {
    if (pendingId === undefined) return
    void window.recorder.cancelChat(pendingId)
  }, [pendingId])

  const reset = useCallback((): void => {
    setMessages([])
    buffer.current.clear()
  }, [])

  // 画面を離れるときに生成を止める。見る人が居ない答えのために 5GB を抱えさせない。
  useEffect(
    () => () => {
      if (pendingRef.current !== undefined) void window.recorder.cancelChat(pendingRef.current)
    },
    []
  )

  return { messages, pendingId, availability, ask, cancel, reset, refresh }
}
