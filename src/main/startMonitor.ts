import {
  dismissStartWatch,
  initialStartWatch,
  observeMicUsage,
  type StartWatchOptions,
  type StartWatchState
} from '@domain/StartWatch'

/**
 * 録音していない間、他のアプリのマイク使用を見張り、続いていれば録音を促す。
 *
 * 判定そのものは domain の observeMicUsage が持つ。ここが担うのは、変化時にしか
 * 届かない使用状態を保持し、外から与えられる時刻で判定へ渡すことだけ。
 * silenceMonitor と同じくタイマーを内側に持たないので、テストは時刻を明示して進められる。
 *
 * 録音中は動かさない。自分自身がマイクを使うため常に「使用中」になり、意味がない。
 */
export interface StartMonitor {
  /** 録音していない間に呼ぶ。options が undefined なら見張らない（設定で無効）。 */
  start(options: StartWatchOptions | undefined): void
  /** 一定間隔で呼ぶ。そのときのマイク使用状態で判定する。 */
  tick(atMs: number): void
  /** 利用者が「今はしない」を選んだ。マイクが空くまで黙る。 */
  dismiss(): void
  stop(): void
}

export const createStartMonitor = (params: {
  onChange: (listener: (inUse: boolean) => void) => void
  onMeetingStarted: () => void
}): StartMonitor => {
  let options: StartWatchOptions | undefined
  let watch: StartWatchState = initialStartWatch()
  // 最後に届いた使用状態。peak と違い変化時にしか届かないので読み捨てない。
  let inUse = false

  params.onChange((next) => {
    inUse = next
  })

  return {
    start(next: StartWatchOptions | undefined): void {
      options = next
      watch = initialStartWatch()
    },

    tick(atMs: number): void {
      const current = options
      if (!current) return

      const result = observeMicUsage(watch, { inUse, atMs }, current)
      watch = result.state
      if (result.alert) params.onMeetingStarted()
    },

    dismiss(): void {
      watch = dismissStartWatch(watch)
    },

    stop(): void {
      options = undefined
      watch = initialStartWatch()
    }
  }
}
