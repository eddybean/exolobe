import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventKitCalendar } from '@infrastructure/calendar/EventKitCalendar'
import { parseCalendarEvents, parseCalendarPermission } from '@infrastructure/calendar/calendarProtocol'
import { resolveCalendarBinary } from '@infrastructure/calendar/resolveCalendarBinary'

const helperEvent = {
  title: '週次定例',
  startMs: Date.parse('2026-09-27T10:00:00+09:00'),
  endMs: Date.parse('2026-09-27T11:00:00+09:00'),
  allDay: false,
  attendees: [
    { name: '山田 太郎', email: 'taro@example.com', isSelf: false, status: 'accepted', kind: 'person' }
  ]
}

describe('parseCalendarEvents', () => {
  it('ヘルパーの JSON を予定に読み替える', () => {
    expect(parseCalendarEvents(JSON.stringify([helperEvent]))).toEqual([
      {
        title: '週次定例',
        startsAt: new Date('2026-09-27T10:00:00+09:00'),
        endsAt: new Date('2026-09-27T11:00:00+09:00'),
        allDay: false,
        attendees: [
          { name: '山田 太郎', email: 'taro@example.com', isSelf: false, status: 'accepted', kind: 'person' }
        ]
      }
    ])
  })

  it('会議の URL を探すための識別子・URL・場所・本文も読む', () => {
    const [event] = parseCalendarEvents(
      JSON.stringify([
        {
          ...helperEvent,
          id: 'EK-1',
          url: 'https://meet.google.com/abc-defg-hij',
          location: '会議室 A',
          notes: '議題は前回の続き'
        }
      ])
    )

    expect(event).toMatchObject({
      id: 'EK-1',
      url: 'https://meet.google.com/abc-defg-hij',
      location: '会議室 A',
      notes: '議題は前回の続き'
    })
  })

  it('識別子や URL が文字列でなければ、無いものとして読む', () => {
    const [event] = parseCalendarEvents(JSON.stringify([{ ...helperEvent, id: 1, notes: null }]))

    expect(event).not.toHaveProperty('id')
    expect(event).not.toHaveProperty('notes')
  })

  it('名前もメールも無い参加者は、欠けたまま読む', () => {
    const [event] = parseCalendarEvents(
      JSON.stringify([{ ...helperEvent, attendees: [{ isSelf: true, status: 'accepted', kind: 'person' }] }])
    )

    expect(event?.attendees).toEqual([{ isSelf: true, status: 'accepted', kind: 'person' }])
  })

  it('知らない参加状況や種類は unknown に倒す', () => {
    const [event] = parseCalendarEvents(
      JSON.stringify([{ ...helperEvent, attendees: [{ name: 'A', isSelf: false, status: 'delegated', kind: 'robot' }] }])
    )

    expect(event?.attendees[0]).toMatchObject({ status: 'unknown', kind: 'unknown' })
  })

  it('形の崩れた予定は落とし、残りは読む', () => {
    const broken = { title: 3, startMs: 'x' }

    expect(parseCalendarEvents(JSON.stringify([broken, helperEvent]))).toHaveLength(1)
  })

  it('JSON として読めなければ予定なしにする', () => {
    expect(parseCalendarEvents('not json')).toEqual([])
    expect(parseCalendarEvents('{"title":"x"}')).toEqual([])
  })
})

describe('parseCalendarPermission', () => {
  it('既知の状態をそのまま読み、それ以外は unknown にする', () => {
    expect(parseCalendarPermission('granted\n')).toBe('granted')
    expect(parseCalendarPermission('not-determined')).toBe('not-determined')
    expect(parseCalendarPermission('write-only')).toBe('write-only')
    expect(parseCalendarPermission('something')).toBe('unknown')
  })
})

describe('resolveCalendarBinary', () => {
  it('配布版は Resources/bin の同梱物を使う', () => {
    const path = resolveCalendarBinary({
      packaged: true,
      resourcesPath: '/Apps/Exolobe.app/Contents/Resources',
      cwd: '/repo',
      exists: () => true
    })

    expect(path).toBe('/Apps/Exolobe.app/Contents/Resources/bin/calendarevents')
  })

  it('開発時はリポジトリの resources/bin を使う', () => {
    const path = resolveCalendarBinary({ packaged: false, resourcesPath: '/ignored', cwd: '/repo', exists: () => true })

    expect(path).toBe('/repo/resources/bin/calendarevents')
  })

  it('同梱物が無ければ undefined を返す（連携だけ無効になる）', () => {
    const path = resolveCalendarBinary({ packaged: false, resourcesPath: '/ignored', cwd: '/repo', exists: () => false })

    expect(path).toBeUndefined()
  })
})

/** calendarevents の代役。実際に spawn して、引数・終了コード・時間切れの扱いを確かめる。 */
describe('EventKitCalendar', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'omr-calendar-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const helper = async (script: string): Promise<string> => {
    const path = join(dir, 'calendarevents')
    await writeFile(path, `#!/bin/sh\n${script}\n`)
    await chmod(path, 0o755)
    return path
  }

  const from = new Date('2026-09-27T10:00:00+09:00')
  const to = new Date('2026-09-27T10:05:00+09:00')

  it('区間をミリ秒で渡し、返った予定を読む', async () => {
    const argsFile = join(dir, 'args')
    const path = await helper(`echo "$@" > '${argsFile}'\necho '${JSON.stringify([helperEvent])}'`)

    const events = await new EventKitCalendar(path).eventsBetween({ from, to })

    expect(events.map((event) => event.title)).toEqual(['週次定例'])
    expect((await readFile(argsFile, 'utf8')).trim()).toBe(`events ${from.getTime()} ${to.getTime()}`)
  })

  it('同梱物が無ければ予定なしにする', async () => {
    expect(await new EventKitCalendar(undefined).eventsBetween({ from, to })).toEqual([])
  })

  it('ヘルパーが失敗したら予定なしにする（権限が無い場合もここに来る）', async () => {
    const path = await helper(`echo '${JSON.stringify([helperEvent])}'\nexit 2`)

    expect(await new EventKitCalendar(path).eventsBetween({ from, to })).toEqual([])
  })

  it('応答が遅ければ打ち切って予定なしにする', async () => {
    const path = await helper('sleep 5')

    const started = Date.now()
    const events = await new EventKitCalendar(path, { timeoutMs: 100 }).eventsBetween({ from, to })

    expect(events).toEqual([])
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('権限の状態を問い合わせる', async () => {
    const path = await helper('[ "$1" = status ] && echo granted')

    expect(await new EventKitCalendar(path).permission()).toBe('granted')
  })

  it('権限を求め、結果の状態を返す', async () => {
    const path = await helper('[ "$1" = request ] && echo denied')

    expect(await new EventKitCalendar(path).requestPermission()).toBe('denied')
  })

  it('同梱物が無ければ権限は unavailable と答える', async () => {
    expect(await new EventKitCalendar(undefined).permission()).toBe('unavailable')
  })
})
