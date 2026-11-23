import { describe, expect, it } from 'vitest'
import { isHeadlineDue, type HeadlineScheduleOptions } from '@domain/LiveHeadlineSchedule'

const options: HeadlineScheduleOptions = {
  intervalMs: 180_000,
  minIntervalMs: 90_000,
  minNewChars: 200,
  pauseMs: 8_000
}

describe('isHeadlineDue', () => {
  it('前回から間隔が経ち、新しい確定文が十分にあれば作る', () => {
    expect(isHeadlineDue({ nowMs: 180_000, lastHeadlineAtMs: 0, newChars: 200, lastFinalAtMs: 179_000 }, options)).toBe(
      true
    )
  })

  it('新しい確定文が少なければ、間隔が経っても作らない', () => {
    expect(isHeadlineDue({ nowMs: 600_000, lastHeadlineAtMs: 0, newChars: 199, lastFinalAtMs: 599_000 }, options)).toBe(
      false
    )
  })

  it('間隔の前でも、話が 8 秒以上途切れたら前倒しで作る', () => {
    expect(isHeadlineDue({ nowMs: 100_000, lastHeadlineAtMs: 0, newChars: 300, lastFinalAtMs: 92_000 }, options)).toBe(
      true
    )
    expect(isHeadlineDue({ nowMs: 100_000, lastHeadlineAtMs: 0, newChars: 300, lastFinalAtMs: 92_001 }, options)).toBe(
      false
    )
  })

  it('前倒しでも、前回から最短の間隔は空ける', () => {
    expect(isHeadlineDue({ nowMs: 89_999, lastHeadlineAtMs: 0, newChars: 300, lastFinalAtMs: 10_000 }, options)).toBe(
      false
    )
  })

  it('まだ確定文が無ければ作らない', () => {
    expect(isHeadlineDue({ nowMs: 600_000, lastHeadlineAtMs: 0, newChars: 0 }, options)).toBe(false)
  })
})
