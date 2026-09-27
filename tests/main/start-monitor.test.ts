import { describe, expect, it, vi } from 'vitest'
import type { CalendarEvent } from '@domain/CalendarEvent'
import type { StartWatchSettings } from '@domain/MeetingStart'
import { createStartMonitor, type MeetingSource } from '../../src/main/startMonitor'

const options: StartWatchSettings = {
  startAlertEnabled: true,
  startAlertDelayMs: 90_000,
  calendarEnabled: false,
  autoStartEnabled: false
}

/** 予定を持たないカレンダー。カレンダー連携の無い従来の振る舞いを確かめるときに使う。 */
const noMeetings: MeetingSource = { refresh: () => undefined, current: () => undefined }

/** 与えた時刻の範囲だけ会議の予定がある、と答える代役。 */
const meetingsDuring = (
  event: CalendarEvent,
  fromMs: number,
  toMs = Number.POSITIVE_INFINITY
): MeetingSource & { refreshes: number[] } => {
  const refreshes: number[] = []
  return {
    refreshes,
    refresh: (atMs) => void refreshes.push(atMs),
    current: (atMs) => (atMs >= fromMs && atMs < toMs ? event : undefined)
  }
}

const meeting: CalendarEvent = {
  id: 'weekly',
  title: '週次定例',
  startsAt: new Date(0),
  endsAt: new Date(3_600_000),
  allDay: false,
  attendees: [],
  notes: 'https://meet.google.com/abc-defg-hij'
}

/** マイクの使用状態を流す側（MicUsageProbe）の最小の代役。 */
const fakeProbe = (): {
  onChange: (listener: (inUse: boolean) => void) => void
  emit: (inUse: boolean) => void
  started: () => number
  stopped: () => number
} => {
  const listeners: ((inUse: boolean) => void)[] = []
  return {
    onChange: (listener) => void listeners.push(listener),
    emit: (inUse) => {
      for (const listener of listeners) listener(inUse)
    },
    started: () => 0,
    stopped: () => 0
  }
}

const tickUntil = (monitor: { tick: (atMs: number) => void }, toMs: number): void => {
  for (let at = 0; at <= toMs; at += 5_000) monitor.tick(at)
}

describe('createStartMonitor', () => {
  it('マイクが使われ続けたら録音を促す', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, meetings: noMeetings, onMeetingStarted })

    monitor.start(options)
    probe.emit(true)
    tickUntil(monitor, 85_000)
    expect(onMeetingStarted).not.toHaveBeenCalled()

    monitor.tick(90_000)
    expect(onMeetingStarted).toHaveBeenCalledTimes(1)
  })

  it('マイクが使われていなければ促さない', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, meetings: noMeetings, onMeetingStarted })

    monitor.start(options)
    tickUntil(monitor, 300_000)

    expect(onMeetingStarted).not.toHaveBeenCalled()
  })

  it('使用状態は変化するまで持ち越す（変化時にしか届かないため）', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, meetings: noMeetings, onMeetingStarted })

    monitor.start(options)
    // 1 度だけ届いた「使用中」がその後の区間にも効き続ける。
    probe.emit(true)
    monitor.tick(0)
    monitor.tick(90_000)

    expect(onMeetingStarted).toHaveBeenCalledTimes(1)
  })

  it('促したあとは繰り返さない', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, meetings: noMeetings, onMeetingStarted })

    monitor.start(options)
    probe.emit(true)
    tickUntil(monitor, 90_000)
    expect(onMeetingStarted).toHaveBeenCalledTimes(1)

    tickUntil(monitor, 600_000)
    expect(onMeetingStarted).toHaveBeenCalledTimes(1)
  })

  it('「今はしない」のあとはマイクが空くまで促さない', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, meetings: noMeetings, onMeetingStarted })

    monitor.start(options)
    probe.emit(true)
    monitor.dismiss()
    tickUntil(monitor, 300_000)
    expect(onMeetingStarted).not.toHaveBeenCalled()

    // 会議を抜けて次の会議に入れば、また促す。
    probe.emit(false)
    monitor.tick(305_000)
    probe.emit(true)
    monitor.tick(310_000)
    monitor.tick(400_000)
    expect(onMeetingStarted).toHaveBeenCalledTimes(1)
  })

  it('停止中は促さない', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, meetings: noMeetings, onMeetingStarted })

    monitor.start(options)
    probe.emit(true)
    monitor.tick(0)
    monitor.stop()
    monitor.tick(90_000)

    expect(onMeetingStarted).not.toHaveBeenCalled()
  })

  it('設定で無効にされていれば動かない', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, meetings: noMeetings, onMeetingStarted })

    monitor.start(undefined)
    probe.emit(true)
    tickUntil(monitor, 300_000)

    expect(onMeetingStarted).not.toHaveBeenCalled()
  })
})

describe('createStartMonitor（カレンダーの予定を加味する、ADR-041）', () => {
  const withCalendar: StartWatchSettings = { ...options, calendarEnabled: true }

  it('会議の予定の時間帯なら、短い時間で予定とともに促す', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({
      onChange: probe.onChange,
      meetings: meetingsDuring(meeting, 0),
      onMeetingStarted
    })

    monitor.start(withCalendar)
    probe.emit(true)
    tickUntil(monitor, 30_000)

    expect(onMeetingStarted).toHaveBeenCalledTimes(1)
    expect(onMeetingStarted).toHaveBeenCalledWith({ action: 'alert', durationMs: 30_000, event: meeting })
  })

  it('自動開始を選んでいれば、開始を依頼する', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({
      onChange: probe.onChange,
      meetings: meetingsDuring(meeting, 0),
      onMeetingStarted
    })

    monitor.start({ ...withCalendar, autoStartEnabled: true })
    probe.emit(true)
    tickUntil(monitor, 30_000)

    expect(onMeetingStarted).toHaveBeenCalledWith({ action: 'auto-start', durationMs: 30_000, event: meeting })
  })

  it('予定はマイクが使われている間だけ問い合わせる', () => {
    const probe = fakeProbe()
    const meetings = meetingsDuring(meeting, 0)
    const monitor = createStartMonitor({ onChange: probe.onChange, meetings, onMeetingStarted: vi.fn() })

    monitor.start(withCalendar)
    monitor.tick(0)
    probe.emit(true)
    monitor.tick(5_000)

    expect(meetings.refreshes).toEqual([5_000])
  })

  it('カレンダー連携が切なら予定を問い合わせない', () => {
    const probe = fakeProbe()
    const meetings = meetingsDuring(meeting, 0)
    const monitor = createStartMonitor({ onChange: probe.onChange, meetings, onMeetingStarted: vi.fn() })

    monitor.start(options)
    probe.emit(true)
    tickUntil(monitor, 30_000)

    expect(meetings.refreshes).toEqual([])
  })

  it('会議前のマイク使用で一度促していても、会議が始まれば改めて判定する', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({
      onChange: probe.onChange,
      meetings: meetingsDuring(meeting, 120_000),
      onMeetingStarted
    })

    monitor.start({ ...withCalendar, autoStartEnabled: true })
    probe.emit(true)
    tickUntil(monitor, 115_000)
    expect(onMeetingStarted).toHaveBeenLastCalledWith({ action: 'alert', durationMs: 90_000 })

    monitor.tick(120_000)
    expect(onMeetingStarted).toHaveBeenLastCalledWith({ action: 'auto-start', durationMs: 30_000, event: meeting })
    expect(onMeetingStarted).toHaveBeenCalledTimes(2)
  })

  it('同じ会議の間は、一度判定したら繰り返さない', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({
      onChange: probe.onChange,
      meetings: meetingsDuring(meeting, 0),
      onMeetingStarted
    })

    monitor.start(withCalendar)
    probe.emit(true)
    tickUntil(monitor, 600_000)

    expect(onMeetingStarted).toHaveBeenCalledTimes(1)
  })

  it('予定が終わっても、黙っているのは解かない（延長した会議で再び促さない）', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({
      onChange: probe.onChange,
      meetings: meetingsDuring(meeting, 0, 60_000),
      onMeetingStarted
    })

    monitor.start(withCalendar)
    probe.emit(true)
    tickUntil(monitor, 600_000)

    expect(onMeetingStarted).toHaveBeenCalledTimes(1)
  })
})
