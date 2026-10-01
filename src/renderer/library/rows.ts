import { libraryListText } from '../i18n/libraryList'

/**
 * 録音一覧の行の見せ方。
 *
 * 行がタイトルとバッヂだけだと、似た名前の定例が並んだときにどれがいつの会議か
 * 見分けられなかった。日付の区切りと、日時・長さの 1 行を足す。
 */

export interface DateGroup<T> {
  readonly label: string
  readonly recordings: readonly T[]
}

const DAY_MS = 86_400_000

/** その日のローカル時刻 0 時。日付の境目は利用者の暦で切る。 */
const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate())

/** 今日から数えて何日前か（今日 = 0）。夏時間で 1 日が 23・25 時間になっても、丸めて日単位にそろえる。 */
const daysAgo = (date: Date, now: Date): number =>
  Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS)

/** 月曜を週の始まりとする曜日の番号（月 = 0 … 日 = 6）。会議は平日の単位で振り返る。 */
const weekdayFromMonday = (date: Date): number => (date.getDay() + 6) % 7

const groupLabel = (date: Date, now: Date): string => {
  const t = libraryListText()
  const days = daysAgo(date, now)
  if (days <= 0) return t.today
  if (days === 1) return t.yesterday
  if (days <= weekdayFromMonday(now)) return t.thisWeek
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return t.thisMonth
  if (date.getFullYear() === now.getFullYear()) return t.monthHeading(date)
  return t.yearMonthHeading(date)
}

/**
 * 録音を日付の区切りに分ける。並びは受け取った順（新しい順）を保つ。
 * 区切りは直近ほど細かく、古いほど月単位で粗くする。
 */
export const groupByDate = <T extends { readonly startedAt: string }>(
  recordings: readonly T[],
  now: Date
): DateGroup<T>[] => {
  const groups: { label: string; recordings: T[] }[] = []
  for (const recording of recordings) {
    const label = groupLabel(new Date(recording.startedAt), now)
    const last = groups.at(-1)
    if (last?.label === label) last.recordings.push(recording)
    else groups.push({ label, recordings: [recording] })
  }
  return groups
}

/** 一覧の行に出す長さ。秒まで出しても探す手掛かりにならないので分で丸める。 */
export const formatRowDuration = (ms: number): string => {
  const t = libraryListText()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return t.underOneMinute
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return t.minutes(minutes)
  return minutes % 60 === 0 ? t.hours(hours) : t.hoursMinutes(hours, minutes % 60)
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** 行の 2 行目。今日・昨日なら日付は見出しが語るので時刻だけにする。 */
export const recordingRowMeta = (
  recording: { readonly startedAt: string; readonly durationMs: number },
  now: Date
): string => {
  const t = libraryListText()
  const date = new Date(recording.startedAt)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const when = daysAgo(date, now) <= 1 ? time : t.rowDateTime(date, time)

  // 録音中は長さが 0 のまま。「1分未満」と出すと終わった録音に見える。
  return recording.durationMs > 0 ? t.joinMeta(when, formatRowDuration(recording.durationMs)) : when
}
