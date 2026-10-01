import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '@domain/CalendarEvent'
import { createMeetingLookup } from '../../src/main/meetingLookup'
import { FakeCalendar } from '../application/fakes'

const at = (hhmm: string): number => Date.parse(`2026-09-27T${hhmm}:00+09:00`)

const meeting: CalendarEvent = {
  id: 'weekly',
  title: '週次定例',
  startsAt: new Date(at('10:00')),
  endsAt: new Date(at('11:00')),
  allDay: false,
  attendees: [],
  notes: 'https://meet.google.com/abc-defg-hij'
}

const offline: CalendarEvent = { ...meeting, id: 'room', title: '対面', notes: '会議室 A' }

const build = () => {
  const calendar = new FakeCalendar()
  calendar.events = [meeting]
  return { calendar, lookup: createMeetingLookup({ calendar, refreshIntervalMs: 60_000 }) }
}

describe('createMeetingLookup', () => {
  it('問い合わせる前は会議なしと答える', () => {
    expect(build().lookup.current(at('10:05'))).toBeUndefined()
  })

  it('いまから少し先までの予定を引き、会議の URL がある予定を答える', async () => {
    const { calendar, lookup } = build()
    calendar.events = [offline, meeting]

    await lookup.refresh(at('10:05'))

    expect(calendar.calls).toEqual([{ from: new Date(at('10:05')), to: new Date(at('10:10')) }])
    expect(lookup.current(at('10:05'))).toBe(meeting)
  })

  it('問い合わせは間隔を空ける（tick のたびに子プロセスを起こさない）', async () => {
    const { calendar, lookup } = build()

    await lookup.refresh(at('10:05'))
    await lookup.refresh(at('10:05') + 30_000)
    await lookup.refresh(at('10:05') + 60_000)

    expect(calendar.calls).toHaveLength(2)
  })

  it('問い合わせに失敗しても例外にせず、会議なしのままにする', async () => {
    const { calendar, lookup } = build()
    calendar.error = new Error('EventKit に接続できません')

    await lookup.refresh(at('10:05'))

    expect(lookup.current(at('10:05'))).toBeUndefined()
  })

  it('扱い終えた会議は答えない', async () => {
    const { lookup } = build()
    await lookup.refresh(at('10:05'))

    lookup.markHandled(meeting)

    expect(lookup.current(at('10:05'))).toBeUndefined()
  })

  it('録音を止めた時点の会議を、問い合わせ直して扱い終えにする', async () => {
    const { calendar, lookup } = build()

    // 手で始めた録音では、見張りが止まっていて予定をまだ引いていない。
    await lookup.markCurrentHandled(at('10:30'))
    await lookup.refresh(at('10:30') + 30_000)

    expect(calendar.calls).toHaveLength(1)
    expect(lookup.current(at('10:30') + 30_000)).toBeUndefined()
  })
})
