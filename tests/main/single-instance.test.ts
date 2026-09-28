import { describe, expect, it } from 'vitest'
import { claimSingleInstance, type SingleInstanceApp } from '../../src/main/singleInstance'

class FakeApp implements SingleInstanceApp {
  quitCalls = 0
  ready = true
  private listener: (() => void) | undefined

  constructor(private readonly lockAvailable: boolean) {}

  requestSingleInstanceLock(): boolean {
    return this.lockAvailable
  }

  quit(): void {
    this.quitCalls += 1
  }

  isReady(): boolean {
    return this.ready
  }

  on(_event: 'second-instance', listener: () => void): void {
    this.listener = listener
  }

  launchSecondInstance(): void {
    this.listener?.()
  }
}

/**
 * 2 つ目の起動は同じ index.json / voiceprints.json に並行して書き、録音も二重になる。
 * 後から起動した側を終わらせ、先にいる側のウィンドウを前に出す。
 */
describe('claimSingleInstance', () => {
  it('ロックを取れたら続行し、終了しない', () => {
    const app = new FakeApp(true)

    expect(claimSingleInstance(app, () => {})).toBe(true)
    expect(app.quitCalls).toBe(0)
  })

  it('既に起動していたら終了し、続行しない', () => {
    const app = new FakeApp(false)

    expect(claimSingleInstance(app, () => {})).toBe(false)
    expect(app.quitCalls).toBe(1)
  })

  it('後から起動されたら、先にいる側のウィンドウを出す', () => {
    const app = new FakeApp(true)
    let shown = 0
    claimSingleInstance(app, () => {
      shown += 1
    })

    app.launchSecondInstance()

    expect(shown).toBe(1)
  })

  it('準備が整う前に後から起動されても、ウィンドウは作らない', () => {
    // ready 前に BrowserWindow を作ると例外になる。ready 後に最初のウィンドウが作られるので何もしなくてよい。
    const app = new FakeApp(true)
    app.ready = false
    let shown = 0
    claimSingleInstance(app, () => {
      shown += 1
    })

    app.launchSecondInstance()

    expect(shown).toBe(0)
  })
})
