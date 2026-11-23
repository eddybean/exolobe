import type { AppleIntelligenceAvailability } from '@domain/AppleIntelligence'
import type { LiveCaptionAvailability } from '@domain/LiveCaption'
import { stampLines, type NoteLine } from '@domain/MeetingNotes'
import type { LiveAssistSettings } from '@domain/Settings'

/**
 * 録音中のアシスト（ADR-050）の画面の判断。描画は RecordingLiveView / LiveAssistPanel。
 */

/**
 * 候補をメモの末尾に足す。stampLines を通すので、足した行には今の経過時間が付き、
 * 既存の行の時刻は動かない（ADR-042）。末尾の空行は、書きかけの次の行として詰めて使う。
 */
export const appendNoteLines = (lines: readonly NoteLine[], texts: readonly string[], atMs: number): NoteLine[] => {
  const kept = [...lines]
  while (kept.length > 0 && kept.at(-1)?.text.trim() === '') kept.pop()
  const body = [...kept.map((line) => line.text), ...texts].join('\n')
  return stampLines(kept, body, atMs)
}

/** 字幕の枠を最下部に追いかけるか。上へ読み戻している間は止める。 */
export const isPinnedToBottom = (box: { scrollTop: number; clientHeight: number; scrollHeight: number }): boolean =>
  box.scrollHeight - box.scrollTop - box.clientHeight <= 16

export interface AssistLayout {
  readonly panel: boolean
  readonly captions: boolean
  readonly headlines: boolean
  /** ここまでの要約と ToDo のボタン。 */
  readonly actions: boolean
}

/**
 * どの部品を出すか。Apple Intelligence の可否が分かるまでは見出しとボタンを隠す —
 * 出してから消すと、押そうとした場所が消える。
 */
export const assistLayout = (
  settings: LiveAssistSettings,
  apple: AppleIntelligenceAvailability | undefined
): AssistLayout => {
  const appleReady = apple === 'available'
  return {
    panel: settings.enabled,
    captions: settings.enabled && settings.captions,
    headlines: settings.enabled && settings.headlines && appleReady,
    actions: settings.enabled && appleReady
  }
}

export type LiveAssistChoice =
  | { readonly selectable: true }
  | { readonly selectable: false; readonly reason?: Exclude<LiveCaptionAvailability, 'available'> }

/** 設定画面で有効にできるか。問い合わせ中は理由なしで選ばせない（「使えません」を点滅させない）。 */
export const liveAssistSetting = (availability: LiveCaptionAvailability | undefined): LiveAssistChoice => {
  if (availability === undefined) return { selectable: false }
  if (availability === 'available') return { selectable: true }
  return { selectable: false, reason: availability }
}
