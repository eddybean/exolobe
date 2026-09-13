import { describe, expect, it } from 'vitest'
import {
  RECENT_DAYS,
  addDays,
  parseDateExpression,
  startOfDay,
  startOfMonth,
  startOfWeek
} from '@domain/DateExpression'

/** 2026-09-13 は日曜。月曜始まりなら今週は 09-07〜09-13。 */
const NOW = new Date('2026-09-13T10:00:00+09:00')

const at = (iso: string): number => new Date(iso).getTime()

describe('parseDateExpression — 週', () => {
  it('「先週」は直前の月曜 00:00 から今週の月曜 00:00 まで', () => {
    const match = parseDateExpression('先週のTODOをまとめて', NOW)

    expect(match?.range.fromMs).toBe(at('2026-08-31T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-09-07T00:00:00+09:00'))
  })

  it('「今週」は日曜に尋ねても直前の月曜から始まる', () => {
    const match = parseDateExpression('今週の決定事項は？', NOW)

    expect(match?.range.fromMs).toBe(at('2026-09-07T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-09-14T00:00:00+09:00'))
  })

  it('「先々週」は 2 つ前の週', () => {
    const match = parseDateExpression('先々週の議事録', NOW)

    expect(match?.range.fromMs).toBe(at('2026-08-24T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-08-31T00:00:00+09:00'))
  })
})

describe('parseDateExpression — 日', () => {
  it('「今日」はその日 1 日', () => {
    const match = parseDateExpression('今日の会議をまとめて', NOW)

    expect(match?.range.fromMs).toBe(at('2026-09-13T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-09-14T00:00:00+09:00'))
  })

  it('「昨日」は前日 1 日', () => {
    const match = parseDateExpression('昨日の打ち合わせ', NOW)

    expect(match?.range.fromMs).toBe(at('2026-09-12T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-09-13T00:00:00+09:00'))
  })

  it('「一昨日」は 2 日前 1 日', () => {
    const match = parseDateExpression('一昨日の話', NOW)

    expect(match?.range.fromMs).toBe(at('2026-09-11T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-09-12T00:00:00+09:00'))
  })

  it('「3日前」はその日 1 日', () => {
    const match = parseDateExpression('3日前の会議', NOW)

    expect(match?.range.fromMs).toBe(at('2026-09-10T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-09-11T00:00:00+09:00'))
  })

  it('「直近5日」は今日を含む 5 日間', () => {
    const match = parseDateExpression('直近5日の決定事項', NOW)

    expect(match?.range.fromMs).toBe(at('2026-09-09T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-09-14T00:00:00+09:00'))
  })

  it('「最近」は今日を含む RECENT_DAYS 日間', () => {
    const match = parseDateExpression('最近のTODO', NOW)

    expect(match?.range.fromMs).toBe(startOfDay(addDays(NOW, -(RECENT_DAYS - 1))).getTime())
    expect(match?.range.toMs).toBe(at('2026-09-14T00:00:00+09:00'))
  })
})

describe('parseDateExpression — 月と年', () => {
  it('「先月」は前月の 1 日から今月の 1 日まで', () => {
    const match = parseDateExpression('先月のふりかえり', NOW)

    expect(match?.range.fromMs).toBe(at('2026-08-01T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-09-01T00:00:00+09:00'))
  })

  it('「9月の」は今年の 9 月', () => {
    const match = parseDateExpression('9月の商談をまとめて', NOW)

    expect(match?.range.fromMs).toBe(at('2026-09-01T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-10-01T00:00:00+09:00'))
  })

  it('今年だと未来になる月は前年として読む', () => {
    const match = parseDateExpression('12月の会議', NOW)

    expect(match?.range.fromMs).toBe(at('2025-12-01T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-01-01T00:00:00+09:00'))
  })

  it('「2025年9月」は年を明示した月', () => {
    const match = parseDateExpression('2025年9月の議事録', NOW)

    expect(match?.range.fromMs).toBe(at('2025-09-01T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2025-10-01T00:00:00+09:00'))
  })

  it('「去年」は前年', () => {
    const match = parseDateExpression('去年の方針', NOW)

    expect(match?.range.fromMs).toBe(at('2025-01-01T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-01-01T00:00:00+09:00'))
  })
})

describe('parseDateExpression — 特定の日付', () => {
  it('「9月8日」はその日 1 日', () => {
    const match = parseDateExpression('9月8日の商談', NOW)

    expect(match?.range.fromMs).toBe(at('2026-09-08T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-09-09T00:00:00+09:00'))
  })

  it('「2026-09-08」もその日 1 日', () => {
    const match = parseDateExpression('2026-09-08 の会議', NOW)

    expect(match?.range.fromMs).toBe(at('2026-09-08T00:00:00+09:00'))
    expect(match?.range.toMs).toBe(at('2026-09-09T00:00:00+09:00'))
  })
})

describe('parseDateExpression — 該当なしと span', () => {
  it('日付の言い回しが無ければ undefined', () => {
    expect(parseDateExpression('A社との商談で決まったことは？', NOW)).toBeUndefined()
  })

  it('spans は日付語が占めた位置を指す', () => {
    const question = '先週のTODOをまとめて'
    const match = parseDateExpression(question, NOW)
    const span = match?.spans[0]

    expect(span).toBeDefined()
    expect(question.slice(span!.start, span!.end)).toBe('先週')
  })

  it('複数の言い回しがあれば最も長いものを 1 つだけ採る', () => {
    const match = parseDateExpression('先々週の話', NOW)

    // 「先週」にも当たりうるが、より長い「先々週」が勝つ。
    expect(match?.range.fromMs).toBe(at('2026-08-24T00:00:00+09:00'))
    expect(match?.spans).toHaveLength(1)
  })

  it('label は利用者に見せる期間の表記になる', () => {
    expect(parseDateExpression('先週のTODO', NOW)?.label).toBe('先週（08/31〜09/06）')
  })
})

describe('日付の補助関数', () => {
  it('startOfWeek は月曜 00:00 を返す', () => {
    expect(startOfWeek(NOW).getTime()).toBe(at('2026-09-07T00:00:00+09:00'))
  })

  it('startOfWeek は月曜に呼べばその日を返す', () => {
    expect(startOfWeek(new Date('2026-09-07T23:00:00+09:00')).getTime()).toBe(
      at('2026-09-07T00:00:00+09:00')
    )
  })

  it('startOfMonth は月初 00:00 を返す', () => {
    expect(startOfMonth(NOW).getTime()).toBe(at('2026-09-01T00:00:00+09:00'))
  })

  it('addDays は月をまたいでも正しく進む', () => {
    expect(addDays(new Date('2026-08-31T00:00:00+09:00'), 1).getTime()).toBe(
      at('2026-09-01T00:00:00+09:00')
    )
  })
})
