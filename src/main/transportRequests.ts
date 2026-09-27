import { toMessage } from '@domain/errors'

/**
 * main 発の録音の開始・停止を renderer に回す。
 *
 * メニュー・トレイ・通知・グローバルショートカットは main で受けるが、マイクは
 * renderer（AudioWorklet）でしか取れない。main で直接録音を始めると相手の声だけが
 * 録れて自分の声が抜け、停止も renderer がマイクを離さないまま終わる。そこで
 * 依頼を置いて renderer に知らせ、renderer が受け取って自分の開始・停止を走らせる。
 *
 * 知らせる（send）だけでなく置いておく（take で受け取る）のは、ウィンドウが無い・
 * 読み込み中のときに知らせが届かず、依頼ごと失われるため。
 */
export type TransportAction = 'start' | 'stop' | 'discard'

/** 受け取られないまま残った依頼を捨てるまでの時間。ウィンドウの起動を待てる長さ。 */
const PENDING_TTL_MS = 30_000

export interface TransportRequests {
  request(action: TransportAction | 'toggle'): void
  /** 置かれた依頼を受け取る。受け取ったら消える。 */
  take(): TransportAction | undefined
}

export const createTransportRequests = (deps: {
  hasRenderer(): boolean
  notifyRenderer(): void
  openWindow(): void
  /** renderer が無いときの停止。離すマイクも無いので main だけで済む。 */
  stopWithoutRenderer(): Promise<unknown>
  /** renderer が無いときの「停止して破棄」（ADR-041）。停止と同じく main だけで済む。 */
  discardWithoutRenderer(): Promise<unknown>
  isActive(): boolean
  now(): number
}): TransportRequests => {
  let pending: { action: TransportAction; atMs: number } | undefined

  return {
    request(requested) {
      const action = requested === 'toggle' ? (deps.isActive() ? 'stop' : 'start') : requested

      if (!deps.hasRenderer()) {
        if (action === 'stop' || action === 'discard') {
          const run = action === 'stop' ? deps.stopWithoutRenderer : deps.discardWithoutRenderer
          void run().catch((error: unknown) => console.error('[transport]', toMessage(error)))
          return
        }
        // 開始にはマイクを取る renderer が要る。ウィンドウを開き、読み込みを終えたら受け取らせる。
        pending = { action, atMs: deps.now() }
        deps.openWindow()
        return
      }

      pending = { action, atMs: deps.now() }
      deps.notifyRenderer()
    },

    take() {
      const current = pending
      pending = undefined
      // 誰も受け取らなかった古い依頼で、後から不意に録音を始めない。
      if (!current || deps.now() - current.atMs > PENDING_TTL_MS) return undefined
      return current.action
    }
  }
}
