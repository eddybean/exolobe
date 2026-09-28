import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@application/usecases/CheckForUpdate'
import { createUpdateChecker } from '../../src/main/updateChecker'

const START_DELAY_MS = 15_000
const TICK_MS = 3_600_000

const statusOf = (version?: string): UpdateStatus => ({
  currentVersion: '0.2.2',
  checkedAt: new Date('2026-09-28T03:00:00Z'),
  available: version
    ? {
        version,
        pageUrl: `https://github.com/eddybean/exolobe/releases/tag/v${version}`,
        installSource: 'dmg'
      }
    : undefined
})

let calls: { force: boolean }[]
let changes: UpdateStatus[]
let next: () => Promise<UpdateStatus>

beforeEach(() => {
  vi.useFakeTimers()
  calls = []
  changes = []
  next = async () => statusOf()
})

afterEach(() => {
  vi.useRealTimers()
})

const setup = () =>
  createUpdateChecker({
    check: (options) => {
      calls.push({ force: options.force ?? false })
      return next()
    },
    onChange: (status) => changes.push(status)
  })

describe('createUpdateChecker', () => {
  it('起動の直後は避けて確かめ、以後は 1 時間ごとに確認の時期かを見る', async () => {
    setup().start()

    await vi.advanceTimersByTimeAsync(START_DELAY_MS - 1)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toEqual([{ force: false }])

    await vi.advanceTimersByTimeAsync(TICK_MS * 2)
    expect(calls).toHaveLength(3)
  })

  it('確かめた結果を覚え、画面に知らせる', async () => {
    next = async () => statusOf('0.3.0')
    const checker = setup()
    checker.start()

    await vi.advanceTimersByTimeAsync(START_DELAY_MS)

    expect(checker.status()?.available?.version).toBe('0.3.0')
    expect(changes.map((status) => status.available?.version)).toEqual(['0.3.0'])
  })

  it('今すぐ確認は間隔を越えて問い合わせる', async () => {
    const checker = setup()

    await checker.checkNow()

    expect(calls).toEqual([{ force: true }])
    expect(changes).toHaveLength(1)
  })

  it('失敗しても前回の結果を保ち、次の機会にまた確かめる', async () => {
    next = async () => statusOf('0.3.0')
    const checker = setup()
    checker.start()
    await vi.advanceTimersByTimeAsync(START_DELAY_MS)

    next = async () => {
      throw new Error('settings.json を読めない')
    }
    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(checker.status()?.available?.version).toBe('0.3.0')

    next = async () => statusOf('0.4.0')
    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(checker.status()?.available?.version).toBe('0.4.0')
  })

  it('確認を重ねて走らせない（問い合わせが二重にならないよう、前の確認を待つ）', async () => {
    let finish: (status: UpdateStatus) => void = () => undefined
    let inFlight = 0
    let maxInFlight = 0
    next = () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise((resolve) => {
        finish = (status) => {
          inFlight -= 1
          resolve(status)
        }
      })
    }
    const checker = setup()

    const first = checker.refresh()
    const second = checker.checkNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    finish(statusOf())
    await first
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(2)
    finish(statusOf('0.3.0'))
    await second

    expect(maxInFlight).toBe(1)
    expect(calls).toEqual([{ force: false }, { force: true }])
    expect(checker.status()?.available?.version).toBe('0.3.0')
  })

  it('止めたら以後は確かめない', async () => {
    const checker = setup()
    checker.start()
    checker.stop()

    await vi.advanceTimersByTimeAsync(START_DELAY_MS + TICK_MS)

    expect(calls).toHaveLength(0)
  })
})
