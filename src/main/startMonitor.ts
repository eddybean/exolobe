import type { CalendarEvent } from '@domain/CalendarEvent'
import {
  meetingEventKey,
  planStartWatch,
  type StartWatchPlan,
  type StartWatchSettings
} from '@domain/MeetingStart'
import {
  DEFAULT_BUSY_RATIO,
  dismissStartWatch,
  initialStartWatch,
  observeMicUsage,
  reopenStartWatch,
  type StartWatchState
} from '@domain/StartWatch'

/**
 * いま行われている会議の予定の出どころ（ADR-041）。
 *
 * 予定の問い合わせは子プロセスを起こす非同期の処理なので、tick の中では待たない。
 * refresh は問い合わせを促すだけで、結果は次の tick 以降の current に現れる。
 */
export interface MeetingSource {
  refresh(atMs: number): void
  current(atMs: number): CalendarEvent | undefined
}

/**
 * 録音していない間、他のアプリのマイク使用を見張り、続いていれば録音を促す（または始める）。
 *
 * 判定そのものは domain の observeMicUsage と planStartWatch が持つ。ここが担うのは、
 * 変化時にしか届かない使用状態を保持し、外から与えられる時刻で判定へ渡すことだけ。
 * silenceMonitor と同じくタイマーを内側に持たないので、テストは時刻を明示して進められる。
 *
 * 録音中は動かさない。自分自身がマイクを使うため常に「使用中」になり、意味がない。
 */
export interface StartMonitor {
  /** 録音していない間に呼ぶ。settings が undefined なら見張らない（設定で無効）。 */
  start(settings: StartWatchSettings | undefined): void
  /** 一定間隔で呼ぶ。そのときのマイク使用状態で判定する。 */
  tick(atMs: number): void
  /** 利用者が「今はしない」を選んだ。マイクが空くまで黙る。 */
  dismiss(): void
  stop(): void
}

export const createStartMonitor = (params: {
  onChange: (listener: (inUse: boolean) => void) => void
  meetings: MeetingSource
  onMeetingStarted: (plan: StartWatchPlan) => void
}): StartMonitor => {
  let settings: StartWatchSettings | undefined
  let watch: StartWatchState = initialStartWatch()
  // 最後に届いた使用状態。peak と違い変化時にしか届かないので読み捨てない。
  let inUse = false
  // 直前の判定で根拠にした会議。変わったときだけ黙っているのを解く。
  let meetingKey: string | undefined

  params.onChange((next) => {
    inUse = next
  })

  return {
    start(next: StartWatchSettings | undefined): void {
      settings = next
      watch = initialStartWatch()
      meetingKey = undefined
    },

    tick(atMs: number): void {
      const current = settings
      if (!current) return

      // 予定を引くのはマイクが使われている間だけ。空いている間に子プロセスを起こし続けない。
      if (current.calendarEnabled && inUse) params.meetings.refresh(atMs)
      const meeting = current.calendarEnabled ? params.meetings.current(atMs) : undefined

      // 新しい会議が現れたら、会議前のマイク使用で黙っていても判定し直す。
      // 予定が終わったときは解かない。延長した会議の最中に再び促すのは邪魔でしかない。
      const key = meeting === undefined ? undefined : meetingEventKey(meeting)
      if (key !== undefined && key !== meetingKey) watch = reopenStartWatch(watch)
      if (key !== undefined) meetingKey = key

      const plan = planStartWatch(current, meeting)
      const result = observeMicUsage(
        watch,
        { inUse, atMs },
        { durationMs: plan.durationMs, busyRatio: DEFAULT_BUSY_RATIO }
      )
      watch = result.state
      if (result.alert && plan.action !== 'none') params.onMeetingStarted(plan)
    },

    dismiss(): void {
      watch = dismissStartWatch(watch)
    },

    stop(): void {
      settings = undefined
      watch = initialStartWatch()
      meetingKey = undefined
    }
  }
}
