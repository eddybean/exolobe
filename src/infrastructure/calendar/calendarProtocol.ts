import type {
  AttendeeKind,
  AttendeeStatus,
  CalendarAttendee,
  CalendarEvent
} from '@domain/CalendarEvent'

/**
 * calendarevents（native/calendarevents/main.swift）との取り決め。
 *
 * `events <fromMs> <toMs>` は予定の配列を JSON で 1 回出す。形の崩れた要素は
 * 落として残りを読む。予定はタイトルの初期値と候補にしか使わないので、
 * 1 件の不備で全体を捨てるより、読めたものを使うほうが利用者の得になる。
 */

export type CalendarPermission =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'write-only'
  /** 同梱物が無く、そもそも問い合わせられない。 */
  | 'unavailable'
  | 'unknown'

const PERMISSIONS: readonly CalendarPermission[] = [
  'granted',
  'denied',
  'restricted',
  'not-determined',
  'write-only'
]

const STATUSES: readonly AttendeeStatus[] = ['accepted', 'declined', 'tentative', 'pending']
const KINDS: readonly AttendeeKind[] = ['person', 'room', 'resource', 'group']

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | 'unknown' =>
  allowed.find((candidate) => candidate === value) ?? 'unknown'

const optionalString = (key: string, value: unknown): Record<string, string> =>
  typeof value === 'string' ? { [key]: value } : {}

const toAttendee = (value: unknown): CalendarAttendee | undefined => {
  if (!isObject(value)) return undefined
  return {
    ...optionalString('name', value['name']),
    ...optionalString('email', value['email']),
    isSelf: value['isSelf'] === true,
    status: oneOf(STATUSES, value['status']),
    kind: oneOf(KINDS, value['kind'])
  }
}

const toEvent = (value: unknown): CalendarEvent | undefined => {
  if (!isObject(value)) return undefined
  const { id, title, startMs, endMs, allDay, attendees, url, location, notes } = value
  if (typeof title !== 'string' || typeof startMs !== 'number' || typeof endMs !== 'number') {
    return undefined
  }

  return {
    ...optionalString('id', id),
    title,
    startsAt: new Date(startMs),
    endsAt: new Date(endMs),
    allDay: allDay === true,
    attendees: Array.isArray(attendees)
      ? attendees.map(toAttendee).filter((attendee) => attendee !== undefined)
      : [],
    ...optionalString('url', url),
    ...optionalString('location', location),
    ...optionalString('notes', notes)
  }
}

export const parseCalendarEvents = (stdout: string): CalendarEvent[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  return parsed.map(toEvent).filter((event) => event !== undefined)
}

export const parseCalendarPermission = (stdout: string): CalendarPermission =>
  PERMISSIONS.find((permission) => permission === stdout.trim()) ?? 'unknown'
