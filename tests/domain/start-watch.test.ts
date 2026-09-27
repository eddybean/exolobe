import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BUSY_RATIO,
  dismissStartWatch,
  initialStartWatch,
  observeMicUsage,
  reopenStartWatch,
  type StartWatchState
} from '../../src/domain/StartWatch'

const options = { durationMs: 90_000, busyRatio: DEFAULT_BUSY_RATIO }

/** 5 秒間隔で標本を与える。main 側の tick と同じ刻み。 */
const feed = (
  state: StartWatchState,
  samples: readonly { inUse: boolean; atMs: number }[]
): { state: StartWatchState; alerts: number } => {
  let current = state
  let alerts = 0

  for (const sample of samples) {
    const result = observeMicUsage(current, sample, options)
    current = result.state
    if (result.alert) alerts += 1
  }

  return { state: current, alerts }
}

const busyFor = (fromMs: number, count: number): { inUse: boolean; atMs: number }[] =>
  Array.from({ length: count }, (_, index) => ({ inUse: true, atMs: fromMs + index * 5_000 }))

describe('observeMicUsage', () => {
  it('マイクが使われ続けたら知らせる', () => {
    // 0ms から 5 秒刻み。90_000ms に達した標本で初めて知らせる。
    const before = feed(initialStartWatch(), busyFor(0, 18))
    expect(before.alerts).toBe(0)

    const after = feed(before.state, [{ inUse: true, atMs: 90_000 }])
    expect(after.alerts).toBe(1)
  })

  it('マイクが使われていなければ数え始めない', () => {
    const result = feed(
      initialStartWatch(),
      Array.from({ length: 30 }, (_, index) => ({ inUse: false, atMs: index * 5_000 }))
    )

    expect(result.alerts).toBe(0)
    expect(result.state.busySinceMs).toBeUndefined()
  })

  it('使用中の割合が崩れたら数え直す', () => {
    const result = feed(initialStartWatch(), [
      { inUse: true, atMs: 0 },
      { inUse: false, atMs: 5_000 },
      ...busyFor(10_000, 17)
    ])

    // 数え直しの起点が 10_000ms になるので、90_000ms ではまだ足りない。
    expect(result.alerts).toBe(0)
    expect(result.state.busySinceMs).toBe(10_000)
  })

  it('短い物音のような 1 標本では計測が止まらない', () => {
    // 割合判定なので、十分な標本が溜まったあとの 1 回の空きでは崩れない。
    const warmed = feed(initialStartWatch(), busyFor(0, 15))
    const result = feed(warmed.state, [
      { inUse: false, atMs: 75_000 },
      { inUse: true, atMs: 80_000 },
      { inUse: true, atMs: 85_000 },
      { inUse: true, atMs: 90_000 }
    ])

    expect(result.alerts).toBe(1)
  })

  it('一度知らせたら繰り返さない', () => {
    const alerted = feed(initialStartWatch(), [...busyFor(0, 18), { inUse: true, atMs: 90_000 }])
    expect(alerted.alerts).toBe(1)

    const after = feed(alerted.state, busyFor(95_000, 60))
    expect(after.alerts).toBe(0)
  })

  it('マイクが空いたら次の会議で再び知らせる', () => {
    const alerted = feed(initialStartWatch(), [...busyFor(0, 18), { inUse: true, atMs: 90_000 }])

    // 会議を抜けてマイクが空くと、そこから数え直せるようになる。
    const idle = feed(alerted.state, [{ inUse: false, atMs: 95_000 }])
    expect(idle.state.busySinceMs).toBeUndefined()

    const next = feed(idle.state, [...busyFor(100_000, 18), { inUse: true, atMs: 190_000 }])
    expect(next.alerts).toBe(1)
  })

  it('「今はしない」を選ばれたらマイクが空くまで黙る', () => {
    const alerted = feed(initialStartWatch(), [...busyFor(0, 18), { inUse: true, atMs: 90_000 }])
    const dismissed = dismissStartWatch(alerted.state)

    const after = feed(dismissed, busyFor(95_000, 60))
    expect(after.alerts).toBe(0)
  })

  it('黙っている間に会議が始まったら、使い続けていた時間ごと判定し直せる（ADR-041）', () => {
    // 会議の前の音声入力などで一度知らせ、黙っている。
    const alerted = feed(initialStartWatch(), [...busyFor(0, 18), { inUse: true, atMs: 90_000 }])

    const reopened = feed(reopenStartWatch(alerted.state), [{ inUse: true, atMs: 95_000 }])

    // 使用は 0ms から続いているので、数え直さずにすぐ判定が届く。
    expect(reopened.alerts).toBe(1)
  })

  it('計測していない状態を開き直しても何も起きない', () => {
    expect(reopenStartWatch(initialStartWatch())).toEqual(initialStartWatch())
  })
})
