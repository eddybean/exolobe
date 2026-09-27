import { describe, expect, it } from 'vitest'
import { createTransportRequests } from '../../src/main/transportRequests'

/**
 * main から来る録音の開始・停止（メニュー・トレイ・通知・グローバルショートカット）を
 * renderer に回す。マイクは renderer でしか取れないので、main で直接開始すると
 * 相手の声だけが録れ、自分の声が抜ける。
 */
const setup = (options: { renderer?: boolean; active?: boolean } = {}) => {
  const calls = { notified: 0, opened: 0, stoppedDirectly: 0, discardedDirectly: 0 }
  let nowMs = 0
  let active = options.active ?? false
  const requests = createTransportRequests({
    hasRenderer: () => options.renderer ?? true,
    notifyRenderer: () => void calls.notified++,
    openWindow: () => void calls.opened++,
    stopWithoutRenderer: async () => void calls.stoppedDirectly++,
    discardWithoutRenderer: async () => void calls.discardedDirectly++,
    isActive: () => active,
    now: () => nowMs
  })
  return {
    requests,
    calls,
    advance: (ms: number) => (nowMs += ms),
    setActive: (value: boolean) => (active = value)
  }
}

describe('createTransportRequests', () => {
  it('開始は renderer に知らせ、renderer が 1 度だけ受け取る', () => {
    const { requests, calls } = setup()

    requests.request('start')

    expect(calls.notified).toBe(1)
    expect(requests.take()).toBe('start')
    expect(requests.take()).toBeUndefined()
  })

  it('ウィンドウが無ければ開き、読み込みを終えた renderer が受け取れるよう残しておく', () => {
    const { requests, calls } = setup({ renderer: false })

    requests.request('start')

    expect(calls.opened).toBe(1)
    expect(requests.take()).toBe('start')
  })

  it('停止は renderer に知らせる（マイクを離させるため）', () => {
    const { requests, calls } = setup({ active: true })

    requests.request('stop')

    expect(calls.notified).toBe(1)
    expect(calls.stoppedDirectly).toBe(0)
    expect(requests.take()).toBe('stop')
  })

  it('renderer が無いときの停止は main で済ませる（離すマイクも無い）', () => {
    const { requests, calls } = setup({ renderer: false, active: true })

    requests.request('stop')

    expect(calls.stoppedDirectly).toBe(1)
    expect(calls.opened).toBe(0)
    expect(requests.take()).toBeUndefined()
  })

  it('切り替えは、いま録音中かどうかで開始か停止に読み替える', () => {
    const idle = setup()
    idle.requests.request('toggle')
    expect(idle.requests.take()).toBe('start')

    const recording = setup({ active: true })
    recording.requests.request('toggle')
    expect(recording.requests.take()).toBe('stop')
  })

  it('受け取られないまま時間が経った依頼は捨てる（後から勝手に録音を始めない）', () => {
    const { requests, advance } = setup({ renderer: false })

    requests.request('start')
    advance(60_000)

    expect(requests.take()).toBeUndefined()
  })

  it('破棄も停止と同じく renderer に回す（マイクを離させてから消す、ADR-041）', () => {
    const { requests, calls } = setup({ active: true })

    requests.request('discard')

    expect(calls.notified).toBe(1)
    expect(requests.take()).toBe('discard')
  })

  it('renderer が無いときの破棄は main で済ませる', () => {
    const { requests, calls } = setup({ renderer: false, active: true })

    requests.request('discard')

    expect(calls.discardedDirectly).toBe(1)
    expect(calls.opened).toBe(0)
  })
})
