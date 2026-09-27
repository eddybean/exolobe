import type { CalendarPort } from '@application/ports'
import { EARLY_START_MARGIN_MS, type CalendarEvent } from '@domain/CalendarEvent'
import { meetingEventKey, pickMeetingEvent } from '@domain/MeetingStart'
import type { MeetingSource } from './startMonitor'

/**
 * 開始忘れの見張りに、いま行われている会議の予定を渡す（ADR-041）。
 *
 * 予定は間隔を空けて引き、その間は手元の結果から時刻に合うものを選ぶ。
 * 見張りは 5 秒ごとに回るので、そのたびに calendarevents を起こすのは無駄が大きい。
 * 引く範囲は「いま〜5 分後」なので、1 分前の結果でも始まったばかりの会議を拾える。
 *
 * 扱い終えた会議（自動で始めた・録音を止めた・破棄した）はここで覚え、以後は答えない。
 * アプリを再起動すると忘れるが、そこまで覚えておく価値はない。
 */
export interface MeetingLookup extends MeetingSource {
  refresh(atMs: number): Promise<void>
  markHandled(event: CalendarEvent): void
  /** 録音を止めた時点の会議を扱い終えにする。見張りが止まっていた間の予定は引き直す。 */
  markCurrentHandled(atMs: number): Promise<void>
}

export const createMeetingLookup = (deps: {
  calendar: CalendarPort
  refreshIntervalMs: number
}): MeetingLookup => {
  let events: CalendarEvent[] = []
  let refreshedAtMs: number | undefined
  const handled = new Set<string>()

  const query = async (atMs: number): Promise<void> => {
    refreshedAtMs = atMs
    try {
      events = await deps.calendar.eventsBetween({
        from: new Date(atMs),
        to: new Date(atMs + EARLY_START_MARGIN_MS)
      })
    } catch {
      // 引けなければ会議なしとして従来どおりに振る舞う。見張りを止めるほどのことではない。
      events = []
    }
  }

  const current = (atMs: number): CalendarEvent | undefined =>
    pickMeetingEvent(events, new Date(atMs), handled)

  return {
    async refresh(atMs) {
      if (refreshedAtMs !== undefined && atMs - refreshedAtMs < deps.refreshIntervalMs) return
      await query(atMs)
    },

    current,

    markHandled(event) {
      handled.add(meetingEventKey(event))
    },

    async markCurrentHandled(atMs) {
      await query(atMs)
      const event = current(atMs)
      if (event) handled.add(meetingEventKey(event))
    }
  }
}
