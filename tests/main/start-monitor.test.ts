import { describe, expect, it, vi } from 'vitest'
import { createStartMonitor } from '../../src/main/startMonitor'

const options = { durationMs: 90_000, busyRatio: 0.9 }

/** マイクの使用状態を流す側（MicUsageProbe）の最小の代役。 */
const fakeProbe = (): {
  onChange: (listener: (inUse: boolean) => void) => void
  emit: (inUse: boolean) => void
  started: () => number
  stopped: () => number
} => {
  const listeners: ((inUse: boolean) => void)[] = []
  return {
    onChange: (listener) => void listeners.push(listener),
    emit: (inUse) => {
      for (const listener of listeners) listener(inUse)
    },
    started: () => 0,
    stopped: () => 0
  }
}

const tickUntil = (monitor: { tick: (atMs: number) => void }, toMs: number): void => {
  for (let at = 0; at <= toMs; at += 5_000) monitor.tick(at)
}

describe('createStartMonitor', () => {
  it('マイクが使われ続けたら録音を促す', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, onMeetingStarted })

    monitor.start(options)
    probe.emit(true)
    tickUntil(monitor, 85_000)
    expect(onMeetingStarted).not.toHaveBeenCalled()

    monitor.tick(90_000)
    expect(onMeetingStarted).toHaveBeenCalledTimes(1)
  })

  it('マイクが使われていなければ促さない', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, onMeetingStarted })

    monitor.start(options)
    tickUntil(monitor, 300_000)

    expect(onMeetingStarted).not.toHaveBeenCalled()
  })

  it('使用状態は変化するまで持ち越す（変化時にしか届かないため）', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, onMeetingStarted })

    monitor.start(options)
    // 1 度だけ届いた「使用中」がその後の区間にも効き続ける。
    probe.emit(true)
    monitor.tick(0)
    monitor.tick(90_000)

    expect(onMeetingStarted).toHaveBeenCalledTimes(1)
  })

  it('促したあとは繰り返さない', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, onMeetingStarted })

    monitor.start(options)
    probe.emit(true)
    tickUntil(monitor, 90_000)
    expect(onMeetingStarted).toHaveBeenCalledTimes(1)

    tickUntil(monitor, 600_000)
    expect(onMeetingStarted).toHaveBeenCalledTimes(1)
  })

  it('「今はしない」のあとはマイクが空くまで促さない', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, onMeetingStarted })

    monitor.start(options)
    probe.emit(true)
    monitor.dismiss()
    tickUntil(monitor, 300_000)
    expect(onMeetingStarted).not.toHaveBeenCalled()

    // 会議を抜けて次の会議に入れば、また促す。
    probe.emit(false)
    monitor.tick(305_000)
    probe.emit(true)
    monitor.tick(310_000)
    monitor.tick(400_000)
    expect(onMeetingStarted).toHaveBeenCalledTimes(1)
  })

  it('停止中は促さない', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, onMeetingStarted })

    monitor.start(options)
    probe.emit(true)
    monitor.tick(0)
    monitor.stop()
    monitor.tick(90_000)

    expect(onMeetingStarted).not.toHaveBeenCalled()
  })

  it('設定で無効にされていれば動かない', () => {
    const probe = fakeProbe()
    const onMeetingStarted = vi.fn()
    const monitor = createStartMonitor({ onChange: probe.onChange, onMeetingStarted })

    monitor.start(undefined)
    probe.emit(true)
    tickUntil(monitor, 300_000)

    expect(onMeetingStarted).not.toHaveBeenCalled()
  })
})
