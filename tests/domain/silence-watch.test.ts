import { describe, expect, it } from 'vitest'
import {
  initialSilenceWatch,
  observeLevel,
  restartSilenceWatch,
  type SilenceWatchOptions,
  type SilenceWatchState
} from '@domain/SilenceWatch'

const options: SilenceWatchOptions = { level: 0.02, durationMs: 60_000, quietRatio: 0.9 }

/** 1 秒ごとの標本を連続して流し込む。level は「その 1 秒の peak」。 */
const feed = (
  state: SilenceWatchState,
  params: { from: number; count: number; level: number }
): { state: SilenceWatchState; alerts: number[] } => {
  const alerts: number[] = []
  let current = state

  for (let index = 0; index < params.count; index += 1) {
    const atMs = params.from + index * 1_000
    const result = observeLevel(current, { level: params.level, atMs }, options)
    current = result.state
    if (result.alert) alerts.push(atMs)
  }

  return { state: current, alerts }
}

describe('observeLevel', () => {
  it('無音が続いた時間が閾値に届くまでは知らせない', () => {
    const quiet = feed(initialSilenceWatch(), { from: 0, count: 60, level: 0 })
    expect(quiet.alerts).toEqual([])

    const { alert } = observeLevel(quiet.state, { level: 0, atMs: 60_000 }, options)
    expect(alert).toBe(true)
  })

  it('しきい値ちょうどの微小な音は無音として扱う', () => {
    const quiet = feed(initialSilenceWatch(), { from: 0, count: 61, level: 0.02 })
    expect(quiet.alerts).toEqual([60_000])
  })

  it('話し声が続けば数え直す', () => {
    const quiet = feed(initialSilenceWatch(), { from: 0, count: 30, level: 0 })
    const loud = feed(quiet.state, { from: 30_000, count: 10, level: 0.5 })
    expect(loud.alerts).toEqual([])

    // 数え直しなので、有音が終わった時点から改めて 60 秒必要になる。
    const again = feed(loud.state, { from: 40_000, count: 61, level: 0 })
    expect(again.alerts).toEqual([100_000])
  })

  /** この方式に変えた理由。単発の物音で 5 分の計測が振り出しに戻らないようにする。 */
  it('ごく短い物音が混ざっても無音とみなし続ける', () => {
    let state = initialSilenceWatch()
    let alerts: number[] = []

    ;({ state } = feed(state, { from: 0, count: 30, level: 0 }))
    // キーボードの打鍵のような 1 秒だけの音。
    ;({ state } = feed(state, { from: 30_000, count: 1, level: 0.5 }))
    ;({ state, alerts } = feed(state, { from: 31_000, count: 30, level: 0 }))

    expect(alerts).toEqual([60_000])
  })

  it('物音が許容割合を超えたら数え直す', () => {
    let state = initialSilenceWatch()
    let alerts: number[] = []

    ;({ state } = feed(state, { from: 0, count: 30, level: 0 }))
    // 30 秒中 5 秒が有音 = 無音は 86% で、許容する 90% を下回る。
    ;({ state } = feed(state, { from: 30_000, count: 5, level: 0.5 }))
    ;({ state, alerts } = feed(state, { from: 35_000, count: 30, level: 0 }))

    expect(alerts).toEqual([])
  })

  it('知らせた後は同じ間隔で繰り返し知らせる', () => {
    const first = feed(initialSilenceWatch(), { from: 0, count: 61, level: 0 })
    expect(first.alerts).toEqual([60_000])

    const second = feed(first.state, { from: 61_000, count: 60, level: 0 })
    expect(second.alerts).toEqual([120_000])
  })

  it('「続ける」を選んだ時刻から数え直せる', () => {
    const quiet = feed(initialSilenceWatch(), { from: 0, count: 61, level: 0 })
    const resumed = feed(restartSilenceWatch(80_000), { from: 81_000, count: 60, level: 0 })

    expect(quiet.alerts).toEqual([60_000])
    expect(resumed.alerts).toEqual([140_000])
  })
})
