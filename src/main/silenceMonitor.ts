import {
  initialSilenceWatch,
  observeLevel,
  restartSilenceWatch,
  type SilenceWatchOptions,
  type SilenceWatchState
} from '@domain/SilenceWatch'

/**
 * 録音中の無音を見張り、続いていれば知らせる。
 *
 * 判定そのものは domain の observeLevel が持つ。ここが担うのは、届く PCM の
 * peak を区間ごとにまとめ、外から与えられる時刻で判定へ渡すことだけ。
 * タイマーを内側に持たないので、テストは時刻を明示して進められる。
 *
 * main プロセスに置いてあるのは、マイクもシステム音声もここへ集まるため。
 * レンダラーで見張ると、ウィンドウを閉じている会議中に効かない。
 */
export interface SilenceMonitor {
  /** 録音開始時に呼ぶ。options が undefined なら見張らない（設定で無効）。 */
  start(options: SilenceWatchOptions | undefined): void
  /** 一定間隔で呼ぶ。前回の呼び出し以降に届いた peak で判定する。 */
  tick(atMs: number): void
  /** 利用者が「録音を続ける」を選んだ。その時刻から数え直す。 */
  dismiss(atMs: number): void
  stop(): void
}

export const createSilenceMonitor = (params: {
  onPeak: (listener: (peak: number) => void) => void
  onSilence: () => void
}): SilenceMonitor => {
  let options: SilenceWatchOptions | undefined
  let watch: SilenceWatchState = initialSilenceWatch()
  // 区間内に届いた最大の peak。判定のたびに読み捨てる。
  let windowPeak = 0

  params.onPeak((peak) => {
    if (peak > windowPeak) windowPeak = peak
  })

  return {
    start(next: SilenceWatchOptions | undefined): void {
      options = next
      watch = initialSilenceWatch()
      windowPeak = 0
    },

    tick(atMs: number): void {
      const current = options
      const level = windowPeak
      windowPeak = 0
      if (!current) return

      const result = observeLevel(watch, { level, atMs }, current)
      watch = result.state
      if (result.alert) params.onSilence()
    },

    dismiss(atMs: number): void {
      watch = restartSilenceWatch(atMs)
      windowPeak = 0
    },

    stop(): void {
      options = undefined
      watch = initialSilenceWatch()
      windowPeak = 0
    }
  }
}
