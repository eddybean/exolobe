import { afterEach, describe, expect, it } from 'vitest'
import { formatRowDuration, groupByDate, recordingRowMeta } from '@renderer/library/rows'
import { setLocale } from '@renderer/i18n/locale'

// vitest は TZ=Asia/Tokyo 固定。2026-09-24 は木曜日。
const now = new Date('2026-09-24T18:00:00+09:00')

const at = (iso: string, id = iso): { id: string; startedAt: string } => ({
  id,
  startedAt: new Date(iso).toISOString()
})

/**
 * 一覧を日付で区切る。録音の行はタイトルだけだと、どれが先週の定例か見分けられなかった。
 * 区切りは「最近ほど細かく、古いほど粗く」—— 直近は日単位で探し、昔の録音は月で探す。
 */
describe('groupByDate', () => {
  it('今日・昨日・今週・今月・それより前の月に分ける（新しい順を保つ）', () => {
    const groups = groupByDate(
      [
        at('2026-09-24T14:00:00+09:00', 'today'),
        at('2026-09-23T17:00:00+09:00', 'yesterday'),
        at('2026-09-21T10:00:00+09:00', 'monday'),
        at('2026-09-10T10:00:00+09:00', 'this-month'),
        at('2026-08-31T10:00:00+09:00', 'august'),
        at('2025-12-01T10:00:00+09:00', 'last-year')
      ],
      now
    )

    expect(groups.map((g) => [g.label, g.recordings.map((r) => r.id)])).toEqual([
      ['今日', ['today']],
      ['昨日', ['yesterday']],
      ['今週', ['monday']],
      ['今月', ['this-month']],
      ['8月', ['august']],
      ['2025年12月', ['last-year']]
    ])
  })

  it('週は月曜始まりで数える（先週の日曜は今週に入れない）', () => {
    const groups = groupByDate([at('2026-09-20T10:00:00+09:00', 'sunday')], now)

    expect(groups.map((g) => g.label)).toEqual(['今月'])
  })

  it('空の区切りは作らない', () => {
    expect(groupByDate([], now)).toEqual([])
  })

  it('日付の境目はローカル時刻で切る（UTC では前日になる早朝も今日）', () => {
    const groups = groupByDate([at('2026-09-24T07:00:00+09:00', 'early')], now)

    expect(groups[0]?.label).toBe('今日')
  })
})

describe('recordingRowMeta', () => {
  it('今日・昨日の区切りの中では時刻だけ出す（日付は見出しが語る）', () => {
    expect(
      recordingRowMeta({ startedAt: new Date('2026-09-24T14:00:00+09:00').toISOString(), durationMs: 42 * 60_000 }, now)
    ).toBe('14:00 ・ 42分')
  })

  it('それより前は日付と曜日を添える', () => {
    expect(
      recordingRowMeta({ startedAt: new Date('2026-09-21T09:05:00+09:00').toISOString(), durationMs: 55 * 60_000 }, now)
    ).toBe('9月21日(月) 09:05 ・ 55分')
  })

  it('長さが未確定（録音中）なら時刻だけ出す', () => {
    expect(
      recordingRowMeta({ startedAt: new Date('2026-09-24T14:00:00+09:00').toISOString(), durationMs: 0 }, now)
    ).toBe('14:00')
  })
})

describe('formatRowDuration', () => {
  it('1 時間を超えたら時間と分で出す', () => {
    expect(formatRowDuration(64 * 60_000)).toBe('1時間4分')
  })

  it('ちょうどの時間は分を省く', () => {
    expect(formatRowDuration(120 * 60_000)).toBe('2時間')
  })

  it('1 分未満はそう書く', () => {
    expect(formatRowDuration(30_000)).toBe('1分未満')
  })
})

describe('英語表示', () => {
  afterEach(() => setLocale('ja'))

  it('区切りの見出しを英語にする', () => {
    setLocale('en')
    const groups = groupByDate(
      [
        at('2026-09-24T14:00:00+09:00', 'today'),
        at('2026-09-23T17:00:00+09:00', 'yesterday'),
        at('2026-09-21T10:00:00+09:00', 'monday'),
        at('2026-09-10T10:00:00+09:00', 'this-month'),
        at('2026-08-31T10:00:00+09:00', 'august'),
        at('2025-12-01T10:00:00+09:00', 'last-year')
      ],
      now
    )

    expect(groups.map((g) => g.label)).toEqual([
      'Today',
      'Yesterday',
      'This Week',
      'This Month',
      'August',
      'December 2025'
    ])
  })

  it('行の長さを英語の単位で出す', () => {
    setLocale('en')
    expect(formatRowDuration(64 * 60_000)).toBe('1 hr 4 min')
    expect(formatRowDuration(120 * 60_000)).toBe('2 hr')
    expect(formatRowDuration(30_000)).toBe('Less than 1 minute')
  })

  it('直近以外の行は月・日・曜日を英語で添える', () => {
    setLocale('en')
    expect(
      recordingRowMeta(
        { startedAt: new Date('2026-09-21T09:05:00+09:00').toISOString(), durationMs: 55 * 60_000 },
        now
      )
    ).toBe('Sep 21 (Mon) 09:05 · 55 min')
  })
})
