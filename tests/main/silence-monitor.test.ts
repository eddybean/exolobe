import { describe, expect, it, vi } from 'vitest'
import { createSilenceMonitor } from '../../src/main/silenceMonitor'

const options = { level: 0.02, durationMs: 300_000, quietRatio: 0.9 }

/** onPeak を購読する側（DualTrackRecorder）の最小の代役。 */
const fakeSource = (): {
  onPeak: (listener: (peak: number) => void) => void
  emit: (peak: number) => void
} => {
  const listeners: ((peak: number) => void)[] = []
  return {
    onPeak: (listener) => void listeners.push(listener),
    emit: (peak) => {
      for (const listener of listeners) listener(peak)
    }
  }
}

describe('createSilenceMonitor', () => {
  it('無音が続いたら知らせる', () => {
    const source = fakeSource()
    const onSilence = vi.fn()
    const monitor = createSilenceMonitor({ onPeak: source.onPeak, onSilence })

    monitor.start(options)
    monitor.tick(0)
    monitor.tick(299_000)
    expect(onSilence).not.toHaveBeenCalled()

    monitor.tick(300_000)
    expect(onSilence).toHaveBeenCalledTimes(1)
  })

  it('区間内に音が入っていれば知らせない', () => {
    const source = fakeSource()
    const onSilence = vi.fn()
    const monitor = createSilenceMonitor({ onPeak: source.onPeak, onSilence })

    monitor.start(options)
    monitor.tick(0)
    source.emit(0.6)
    monitor.tick(150_000)
    monitor.tick(300_000)

    expect(onSilence).not.toHaveBeenCalled()
  })

  it('peak は区間ごとに読み捨てる（過去の音で無音判定が止まり続けない）', () => {
    const source = fakeSource()
    const onSilence = vi.fn()
    const monitor = createSilenceMonitor({ onPeak: source.onPeak, onSilence })

    monitor.start(options)
    source.emit(0.6)
    monitor.tick(0)
    monitor.tick(300_000)
    expect(onSilence).not.toHaveBeenCalled()

    // 最初の区間で消費された音が、後の区間の判定に残らない。
    monitor.tick(600_000)
    expect(onSilence).toHaveBeenCalledTimes(1)
  })

  it('「続ける」を選んだらそこから数え直す', () => {
    const source = fakeSource()
    const onSilence = vi.fn()
    const monitor = createSilenceMonitor({ onPeak: source.onPeak, onSilence })

    monitor.start(options)
    monitor.tick(0)
    monitor.tick(300_000)
    expect(onSilence).toHaveBeenCalledTimes(1)

    monitor.dismiss(400_000)

    // 知らせた時刻ではなく「続ける」を選んだ時刻から数え直す。
    monitor.tick(600_000)
    expect(onSilence).toHaveBeenCalledTimes(1)

    monitor.tick(700_000)
    expect(onSilence).toHaveBeenCalledTimes(2)
  })

  it('停止中は知らせない', () => {
    const source = fakeSource()
    const onSilence = vi.fn()
    const monitor = createSilenceMonitor({ onPeak: source.onPeak, onSilence })

    monitor.start(options)
    monitor.tick(0)
    monitor.stop()
    monitor.tick(300_000)

    expect(onSilence).not.toHaveBeenCalled()
  })

  it('設定で無効にされていれば動かない', () => {
    const source = fakeSource()
    const onSilence = vi.fn()
    const monitor = createSilenceMonitor({ onPeak: source.onPeak, onSilence })

    monitor.start(undefined)
    monitor.tick(0)
    monitor.tick(300_000)

    expect(onSilence).not.toHaveBeenCalled()
  })
})
