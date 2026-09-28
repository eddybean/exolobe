import type { UpdateStatus } from '@application/usecases/CheckForUpdate'

/**
 * 起動してから最初に確かめるまでの間。起動直後はワーカーの準備や画面の描画と重なるので避ける。
 */
const START_DELAY_MS = 15_000

/**
 * 確認の時期かを見る間隔。問い合わせるかどうかはユースケースが設定の間隔で決めるので、
 * ここは「開きっぱなしのアプリでも時期を逃さない」ための見回りに過ぎない。時期でなければ通信しない。
 */
const TICK_MS = 3_600_000

export interface UpdateChecker {
  start(): void
  stop(): void
  /** 最後に得た結果。まだ一度も確かめていなければ undefined。 */
  status(): UpdateStatus | undefined
  /** 確認の時期なら確かめる。設定の間隔が変わったときにも呼ぶ。 */
  refresh(): Promise<UpdateStatus | undefined>
  /** 利用者の「今すぐ確認」。間隔も「確認しない」も越えて問い合わせる。 */
  checkNow(): Promise<UpdateStatus | undefined>
}

/**
 * 新しい版の確認を裏で回す（ADR-044）。
 *
 * 確認は 1 本ずつ直列に走らせる。起動時の確認と「今すぐ確認」が重なって、
 * GitHub へ二重に問い合わせたり、古い結果が新しい結果を上書きしたりしないように。
 * 失敗は握りつぶして前回の結果を保つ — 知らせるだけの機能で、利用者に見せる失敗は無い。
 */
export const createUpdateChecker = (deps: {
  check: (options: { force?: boolean }) => Promise<UpdateStatus>
  onChange: (status: UpdateStatus) => void
}): UpdateChecker => {
  let latest: UpdateStatus | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let startTimer: ReturnType<typeof setTimeout> | undefined
  let tickTimer: ReturnType<typeof setInterval> | undefined

  const run = (force: boolean): Promise<UpdateStatus | undefined> => {
    const task = queue.then(async () => {
      try {
        latest = await deps.check({ force })
        deps.onChange(latest)
      } catch {
        // 前回の結果を保ち、次の見回りで確かめ直す。
      }
      return latest
    })
    queue = task
    return task
  }

  return {
    start: () => {
      startTimer = setTimeout(() => void run(false), START_DELAY_MS)
      tickTimer = setInterval(() => void run(false), TICK_MS)
    },
    stop: () => {
      clearTimeout(startTimer)
      clearInterval(tickTimer)
    },
    status: () => latest,
    refresh: () => run(false),
    checkNow: () => run(true)
  }
}
