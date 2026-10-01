/**
 * 新しい版の通知（ADR-044）。
 *
 * アプリは自分を入れ替えず、新しい版があることと、入れ方に応じた更新の手順を知らせるだけ。
 * ad-hoc 署名では Squirrel.Mac の検証が通らず、自動更新の仕組みが使えないため。
 */

/**
 * 更新を確かめる間隔。`never` は GitHub に一切問い合わせない。
 *
 * 通知は急ぐものではないので、1 日より細かくは刻まない。
 */
export type UpdateCheckInterval = 'daily' | 'weekly' | 'monthly' | 'never'

export const UPDATE_CHECK_INTERVALS: readonly UpdateCheckInterval[] = ['daily', 'weekly', 'monthly', 'never']

export const isUpdateCheckInterval = (value: unknown): value is UpdateCheckInterval =>
  UPDATE_CHECK_INTERVALS.includes(value as UpdateCheckInterval)

const DAY_MS = 86_400_000

const INTERVAL_MS: Record<Exclude<UpdateCheckInterval, 'never'>, number> = {
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
  monthly: 30 * DAY_MS
}

/**
 * どこから入れたか。入れ方によって更新の手順が違う。
 *
 * Homebrew で入れた人に DMG を案内すると、brew の記録と実体の版が食い違う。
 */
export type InstallSource = 'homebrew' | 'dmg'

type Version = readonly [number, number, number]

/**
 * タグ（`v0.2.1`）やアプリの版（`0.2.1`）を数の組にする。
 *
 * プレリリースの付いたものは読まない。latest の Release には出てこないはずで、
 * 出てきたとしても知らせる対象ではない。
 */
export const parseVersion = (text: string): Version | undefined => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim())
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** `latest` が `current` より新しいか。どちらかが読めなければ、知らせない側に倒す。 */
export const isNewerVersion = (latest: string, current: string): boolean => {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/**
 * いま確かめる時期か。
 *
 * 前回が未来にあるのは時計が戻ったときで、そのままだと間隔の分だけ確認が止まるので確かめ直す。
 */
export const isUpdateCheckDue = (params: {
  interval: UpdateCheckInterval
  lastCheckedAt: Date | undefined
  now: Date
}): boolean => {
  if (params.interval === 'never') return false
  if (!params.lastCheckedAt) return true
  const elapsed = params.now.getTime() - params.lastCheckedAt.getTime()
  return elapsed < 0 || elapsed >= INTERVAL_MS[params.interval]
}
