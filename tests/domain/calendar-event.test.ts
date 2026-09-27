import { describe, expect, it } from 'vitest'
import {
  participantNames,
  pickEventForRecording,
  type CalendarAttendee,
  type CalendarEvent
} from '@domain/CalendarEvent'

const at = (hhmm: string): Date => new Date(`2026-09-27T${hhmm}:00+09:00`)

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  title: '定例',
  startsAt: at('10:00'),
  endsAt: at('11:00'),
  allDay: false,
  attendees: [],
  ...overrides
})

const attendee = (overrides: Partial<CalendarAttendee> = {}): CalendarAttendee => ({
  name: '山田 太郎',
  isSelf: false,
  status: 'accepted',
  kind: 'person',
  ...overrides
})

describe('pickEventForRecording', () => {
  it('録音開始時刻に進行中の予定を選ぶ', () => {
    const meeting = event()
    expect(pickEventForRecording([meeting], at('10:10'))).toBe(meeting)
  })

  it('少し前に録音を始めても、まもなく始まる予定を選ぶ', () => {
    const meeting = event()
    expect(pickEventForRecording([meeting], at('09:56'))).toBe(meeting)
  })

  it('開始までまだ間がある予定は選ばない', () => {
    expect(pickEventForRecording([event()], at('09:40'))).toBeUndefined()
  })

  it('終わった予定は選ばない', () => {
    expect(pickEventForRecording([event()], at('11:00'))).toBeUndefined()
  })

  it('終日の予定は会議とみなさない', () => {
    const allDay = event({ allDay: true, startsAt: at('00:00'), endsAt: at('23:59') })
    expect(pickEventForRecording([allDay], at('10:10'))).toBeUndefined()
  })

  it('自分が辞退した予定は選ばない', () => {
    const declined = event({ attendees: [attendee({ isSelf: true, status: 'declined' })] })
    expect(pickEventForRecording([declined], at('10:10'))).toBeUndefined()
  })

  it('重なる予定が複数あれば、開始時刻が録音開始に最も近いものを選ぶ', () => {
    const long = event({ title: '終日ワークショップ枠', startsAt: at('09:00'), endsAt: at('12:00') })
    const next = event({ title: '1on1', startsAt: at('10:30'), endsAt: at('11:00') })
    expect(pickEventForRecording([long, next], at('10:28'))).toBe(next)
  })
})

describe('participantNames', () => {
  it('自分以外の参加者名を並び順のまま返す', () => {
    const meeting = event({
      attendees: [
        attendee({ name: '自分', isSelf: true }),
        attendee({ name: '山田 太郎' }),
        attendee({ name: '佐藤 花子' })
      ]
    })
    expect(participantNames(meeting)).toEqual(['山田 太郎', '佐藤 花子'])
  })

  it('名前が無ければメールアドレスの @ より前を使う', () => {
    const meeting = event({ attendees: [attendee({ name: undefined, email: 'hanako.sato@example.com' })] })
    expect(participantNames(meeting)).toEqual(['hanako.sato'])
  })

  it('会議室や設備、辞退した人は除く', () => {
    const meeting = event({
      attendees: [
        attendee({ name: '会議室A', kind: 'room' }),
        attendee({ name: 'プロジェクター', kind: 'resource' }),
        attendee({ name: '欠席者', status: 'declined' }),
        attendee({ name: '出席者' })
      ]
    })
    expect(participantNames(meeting)).toEqual(['出席者'])
  })

  it('空白を詰め、重複と空の名前を落とす', () => {
    const meeting = event({
      attendees: [
        attendee({ name: '  山田 太郎 ' }),
        attendee({ name: '山田 太郎' }),
        attendee({ name: '   ', email: undefined })
      ]
    })
    expect(participantNames(meeting)).toEqual(['山田 太郎'])
  })
})
