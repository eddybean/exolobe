import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '@domain/CalendarEvent'
import {
  MEETING_START_DELAY_MS,
  hasMeetingLink,
  meetingEventKey,
  pickMeetingEvent,
  planStartWatch,
  type StartWatchSettings
} from '@domain/MeetingStart'

const at = (hhmm: string): Date => new Date(`2026-09-27T${hhmm}:00+09:00`)

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  title: '週次定例',
  startsAt: at('10:00'),
  endsAt: at('11:00'),
  allDay: false,
  attendees: [],
  notes: '参加: https://meet.google.com/abc-defg-hij',
  ...overrides
})

describe('hasMeetingLink', () => {
  it('本文・場所・URL のどこかに会議の URL があれば会議とみなす', () => {
    expect(hasMeetingLink(event({ notes: 'https://meet.google.com/abc-defg-hij' }))).toBe(true)
    expect(hasMeetingLink(event({ notes: undefined, location: 'https://us02web.zoom.us/j/123456789' }))).toBe(true)
    expect(
      hasMeetingLink(event({ notes: undefined, url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting' }))
    ).toBe(true)
    expect(hasMeetingLink(event({ notes: 'https://teams.live.com/meet/9876' }))).toBe(true)
  })

  it('Outlook の安全なリンクに包まれた Teams の URL も読む', () => {
    const wrapped = `https://nam06.safelinks.protection.outlook.com/?url=${encodeURIComponent(
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting'
    )}&data=xyz`

    expect(hasMeetingLink(event({ notes: `参加はこちら ${wrapped}` }))).toBe(true)
  })

  it('会議サービス以外の URL や、ホスト名に紛れ込んだだけの文字列は会議とみなさない', () => {
    expect(hasMeetingLink(event({ notes: 'https://example.com/zoom.us/j/1' }))).toBe(false)
    expect(hasMeetingLink(event({ notes: 'https://notzoom.us/j/1' }))).toBe(false)
    expect(hasMeetingLink(event({ notes: '会議室 A で対面' }))).toBe(false)
    expect(hasMeetingLink(event({ notes: undefined }))).toBe(false)
  })
})

describe('meetingEventKey', () => {
  it('繰り返しの予定も回ごとに区別する', () => {
    const first = event({ id: 'weekly' })
    const next = event({ id: 'weekly', startsAt: new Date(at('10:00').getTime() + 7 * 86_400_000) })

    expect(meetingEventKey(first)).not.toBe(meetingEventKey(next))
  })
})

describe('pickMeetingEvent', () => {
  it('会議の URL がある予定だけから選ぶ', () => {
    const offline = event({ title: '対面の打ち合わせ', notes: '会議室 A', startsAt: at('10:05') })
    const online = event()

    expect(pickMeetingEvent([offline, online], at('10:05'), new Set())).toBe(online)
  })

  it('扱い終えた予定は選ばない', () => {
    const online = event()

    expect(pickMeetingEvent([online], at('10:05'), new Set([meetingEventKey(online)]))).toBeUndefined()
  })
})

describe('planStartWatch', () => {
  const settings: StartWatchSettings = {
    startAlertEnabled: true,
    startAlertDelayMs: 90_000,
    calendarEnabled: true,
    autoStartEnabled: false
  }
  const meeting = event()

  it('予定が無ければ、従来どおり設定の時間で録音を促す', () => {
    expect(planStartWatch(settings, undefined)).toEqual({ action: 'alert', durationMs: 90_000 })
  })

  it('会議の予定があれば、短い時間で予定名とともに促す', () => {
    expect(planStartWatch(settings, meeting)).toEqual({
      action: 'alert',
      durationMs: MEETING_START_DELAY_MS,
      event: meeting
    })
  })

  it('設定の時間の方が短ければ、そちらに合わせる', () => {
    expect(planStartWatch({ ...settings, startAlertDelayMs: 20_000 }, meeting).durationMs).toBe(20_000)
  })

  it('自動開始を選んでいれば、会議の予定があるときだけ録音を始める', () => {
    const auto = { ...settings, autoStartEnabled: true }

    expect(planStartWatch(auto, meeting)).toEqual({
      action: 'auto-start',
      durationMs: MEETING_START_DELAY_MS,
      event: meeting
    })
    expect(planStartWatch(auto, undefined)).toEqual({ action: 'alert', durationMs: 90_000 })
  })

  it('カレンダー連携が切なら、予定があっても従来どおり（自動開始の設定も効かない）', () => {
    const off = { ...settings, calendarEnabled: false, autoStartEnabled: true }

    expect(planStartWatch(off, meeting)).toEqual({ action: 'alert', durationMs: 90_000 })
  })

  it('促す設定が切なら、予定が無いときは何もしない（数えるだけ）', () => {
    const quiet = { ...settings, startAlertEnabled: false, autoStartEnabled: true }

    expect(planStartWatch(quiet, undefined)).toEqual({ action: 'none', durationMs: Number.POSITIVE_INFINITY })
    expect(planStartWatch(quiet, meeting).action).toBe('auto-start')
  })

  it('促す設定も自動開始も切なら、会議の予定があっても何もしない', () => {
    const quiet = { ...settings, startAlertEnabled: false }

    expect(planStartWatch(quiet, meeting).action).toBe('none')
  })
})
