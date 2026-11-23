import { useCallback, useEffect, useState } from 'react'
import { applyCaptionEvent, initialLiveCaption, type LiveCaptionState } from '@domain/LiveCaption'
import type { LiveAssistStatusDto, LiveHeadlineDto, LiveSuggestionDto } from '@shared/ipc'

export interface LiveAssist {
  readonly status: LiveAssistStatusDto
  readonly captions: LiveCaptionState
  /** 過去の録音のカード。出すのは 1 枚だけで、次の提示で置き換える。 */
  readonly suggestion: LiveSuggestionDto | undefined
  readonly headline: LiveHeadlineDto | undefined
  dismissSuggestion(): void
}

const OFF: LiveAssistStatusDto = { state: 'off' }

/**
 * 録音中のアシスト（ADR-050）の push を受ける。録音中の画面より前から購読しておくのは、
 * 画面が開く前に届いた状態（準備中・取得中）を落とさないため。録音が終われば次へ持ち越さない。
 */
export const useLiveAssist = (active: boolean): LiveAssist => {
  const [status, setStatus] = useState<LiveAssistStatusDto>(OFF)
  const [captions, setCaptions] = useState<LiveCaptionState>(initialLiveCaption)
  const [suggestion, setSuggestion] = useState<LiveSuggestionDto>()
  const [headline, setHeadline] = useState<LiveHeadlineDto>()

  useEffect(() => window.recorder.onLiveAssistStatus(setStatus), [])
  useEffect(
    () => window.recorder.onLiveCaption((event) => setCaptions((current) => applyCaptionEvent(current, event))),
    []
  )
  useEffect(() => window.recorder.onLiveSuggestion(setSuggestion), [])
  useEffect(() => window.recorder.onLiveHeadline(setHeadline), [])

  useEffect(() => {
    if (active) return
    setCaptions(initialLiveCaption())
    setSuggestion(undefined)
    setHeadline(undefined)
  }, [active])

  const dismissSuggestion = useCallback((): void => {
    setSuggestion((current) => {
      if (current) void window.recorder.dismissLiveSuggestion(current.recordingId).catch(() => undefined)
      return undefined
    })
  }, [])

  return { status, captions, suggestion, headline, dismissSuggestion }
}
