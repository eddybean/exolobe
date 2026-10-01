import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSearchSyncScheduler, type SearchSyncState } from '../../src/main/searchSyncScheduler'

const DEBOUNCE_MS = 3_000

/** 完了を手で起こせる run。 */
const controllableRun = (): {
  run: (onProgress: (done: number, total: number) => void) => Promise<void>
  calls: number
  progress: ((done: number, total: number) => void) | undefined
  finish: () => void
  fail: (error: Error) => void
} => {
  const handle = {
    calls: 0,
    progress: undefined as ((done: number, total: number) => void) | undefined,
    finish: () => undefined as void,
    fail: (_error: Error) => undefined as void,
    run: (onProgress: (done: number, total: number) => void): Promise<void> => {
      handle.calls += 1
      handle.progress = onProgress
      return new Promise<void>((resolve, reject) => {
        handle.finish = resolve
        handle.fail = reject
      })
    }
  }
  return handle
}

let enabled: boolean
let busy: boolean
let states: SearchSyncState[]

beforeEach(() => {
  vi.useFakeTimers()
  enabled = true
  busy = false
  states = []
})

afterEach(() => {
  vi.useRealTimers()
})

const setup = (
  run: (onProgress: (done: number, total: number) => void) => Promise<void>
): ReturnType<typeof createSearchSyncScheduler> =>
  createSearchSyncScheduler({
    isEnabled: async () => enabled,
    isBusy: () => busy,
    run,
    onStateChange: (state) => states.push(state),
    debounceMs: DEBOUNCE_MS
  })

describe('createSearchSyncScheduler', () => {
  it('続けて届いた依頼を 1 回の同期にまとめる', async () => {
    const handle = controllableRun()
    const scheduler = setup(handle.run)

    scheduler.request()
    scheduler.request()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1)
    expect(handle.calls).toBe(0)
    scheduler.request()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(handle.calls).toBe(1)
    expect(scheduler.state()).toEqual({ state: 'running', done: 0, total: 0 })
  })

  it('進捗を状態として知らせ、終われば idle に戻る', async () => {
    const handle = controllableRun()
    const scheduler = setup(handle.run)

    scheduler.request()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    handle.progress?.(1, 3)
    expect(scheduler.state()).toEqual({ state: 'running', done: 1, total: 3 })

    handle.finish()
    await vi.advanceTimersByTimeAsync(0)

    expect(scheduler.state()).toEqual({ state: 'idle' })
    expect(states.at(-1)).toEqual({ state: 'idle' })
  })

  it('意味検索が無効なら同期しない', async () => {
    enabled = false
    const handle = controllableRun()
    const scheduler = setup(handle.run)

    scheduler.request()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(handle.calls).toBe(0)
    expect(scheduler.state()).toEqual({ state: 'idle' })
  })

  it('パイプラインの実行中は待たせ、次の依頼で動く', async () => {
    busy = true
    const handle = controllableRun()
    const scheduler = setup(handle.run)

    scheduler.request()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(handle.calls).toBe(0)
    expect(scheduler.state()).toEqual({ state: 'waiting' })

    busy = false
    scheduler.request()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(handle.calls).toBe(1)
  })

  it('同期中に届いた依頼は、終わった後に 1 回だけやり直す', async () => {
    const handle = controllableRun()
    const scheduler = setup(handle.run)

    scheduler.request()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    scheduler.request()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    scheduler.request()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(handle.calls).toBe(1)

    handle.finish()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(handle.calls).toBe(2)
  })

  it('失敗したら理由を状態に残す', async () => {
    const handle = controllableRun()
    const scheduler = setup(handle.run)

    scheduler.request()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    handle.fail(new Error('モデルを読み込めませんでした'))
    await vi.advanceTimersByTimeAsync(0)

    expect(scheduler.state()).toEqual({
      state: 'error',
      message: 'モデルを読み込めませんでした'
    })
  })

  it('途中でパイプラインに譲った同期は、終わった後 waiting にする', async () => {
    const handle = controllableRun()
    const scheduler = setup(handle.run)

    scheduler.request()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    busy = true
    handle.finish()
    await vi.advanceTimersByTimeAsync(0)

    expect(scheduler.state()).toEqual({ state: 'waiting' })
  })

  it('リセット後は、止めた同期の失敗を状態に反映しない', async () => {
    const handle = controllableRun()
    const scheduler = setup(handle.run)

    scheduler.request()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    scheduler.reset()
    handle.fail(new Error('処理プロセスが終了しました'))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(scheduler.state()).toEqual({ state: 'idle' })
    expect(handle.calls).toBe(1)
  })

  it('リセットは待機中の依頼も取り消す', async () => {
    const handle = controllableRun()
    const scheduler = setup(handle.run)

    scheduler.request()
    scheduler.reset()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(handle.calls).toBe(0)
  })
})
