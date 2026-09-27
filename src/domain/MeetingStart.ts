import { pickEventForRecording, type CalendarEvent } from './CalendarEvent'

/**
 * カレンダーの予定を加味した「録音の開始忘れ」の扱い（ADR-041）。
 *
 * マイクの使用だけでは会議かどうか分からない（音声入力、ボイスメモ、着信の確認）ので、
 * ADR-027 は知らせるだけにとどめた。オンライン会議の URL を含む予定の時間帯なら、
 * マイクの使用はほぼ会議を意味する。そのときは短い時間で知らせ、利用者が選んでいれば
 * 録音を始める。カレンダー連携が切なら、ここは従来の ADR-027 の振る舞いを返すだけ。
 */

/**
 * 会議の予定と重なっているときに、マイクの使用をこの時間見届けたら動く。
 *
 * 会議アプリはつないだ直後からマイクを掴むので、予定という裏付けがあれば長く待つ理由は薄い。
 * 待つほど冒頭を取り逃す。一方で、接続の確認だけで抜けるような一瞬の使用には反応しない長さにする。
 * 設定で下限にしている 30 秒と揃えてある。
 */
export const MEETING_START_DELAY_MS = 30_000

/** オンライン会議とみなす URL のホスト。サブドメイン（us02web.zoom.us など）も含める。 */
const MEETING_HOSTS = ['meet.google.com', 'zoom.us', 'zoomgov.com', 'teams.microsoft.com', 'teams.live.com']

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/g

const isMeetingHost = (hostname: string): boolean =>
  MEETING_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))

const parseUrl = (text: string): URL | undefined => {
  try {
    return new URL(text)
  } catch {
    return undefined
  }
}

/**
 * Outlook は本文のリンクを safelinks.protection.outlook.com で包む。
 * 包まれたままでは Teams の予定を見落とすので、中身の URL も確かめる。
 */
const isMeetingUrl = (url: URL): boolean => {
  if (isMeetingHost(url.hostname)) return true
  if (!url.hostname.endsWith('safelinks.protection.outlook.com')) return false
  const inner = url.searchParams.get('url')
  const parsed = inner === null ? undefined : parseUrl(inner)
  return parsed !== undefined && isMeetingHost(parsed.hostname)
}

const containsMeetingUrl = (text: string | undefined): boolean =>
  text !== undefined &&
  [...text.matchAll(URL_PATTERN)].some((match) => {
    const url = parseUrl(match[0])
    return url !== undefined && isMeetingUrl(url)
  })

/** 本文・場所・URL のどこかにオンライン会議の URL があるか。 */
export const hasMeetingLink = (event: CalendarEvent): boolean =>
  [event.url, event.location, event.notes].some(containsMeetingUrl)

/** 予定を 1 回ごとに区別する鍵。同じ会議で二度自動開始しないために使う。 */
export const meetingEventKey = (event: CalendarEvent): string =>
  `${event.id ?? event.title}@${event.startsAt.getTime()}`

/**
 * 今まさに行われている会議の予定。扱い終えたもの（自動で始めた・録音を止めた・破棄した）は除く。
 *
 * 利用者が止めた会議で録音をやり直させないため。止めたのは「この会議はもう録らない」という
 * 判断で、推定でそれを押し戻さない。
 */
export const pickMeetingEvent = (
  events: readonly CalendarEvent[],
  at: Date,
  handled: ReadonlySet<string>
): CalendarEvent | undefined =>
  pickEventForRecording(
    events.filter((event) => hasMeetingLink(event) && !handled.has(meetingEventKey(event))),
    at
  )

export interface StartWatchSettings {
  readonly startAlertEnabled: boolean
  readonly startAlertDelayMs: number
  readonly calendarEnabled: boolean
  readonly autoStartEnabled: boolean
}

export type StartWatchPlan =
  | {
      readonly action: 'alert' | 'none'
      readonly durationMs: number
    }
  | {
      readonly action: 'alert' | 'auto-start' | 'none'
      readonly durationMs: number
      /** 判定の根拠にした会議の予定。通知の文面と、扱い終えた記録に使う。 */
      readonly event: CalendarEvent
    }

/** 見届けても何もしない。使用の計測だけは続け、会議の予定が現れたときの判定に使う。 */
const WATCH_ONLY: StartWatchPlan = { action: 'none', durationMs: Number.POSITIVE_INFINITY }

/**
 * いまのマイク使用に対して、どれだけ見届けたら何をするか。
 *
 * 自動開始は「会議の予定がある」ときだけ。予定が無いときに自動開始の設定が効くと、
 * ADR-027 が避けた「会議ではないマイク使用で録音が始まる」ことが起きる。
 */
export const planStartWatch = (
  settings: StartWatchSettings,
  meeting: CalendarEvent | undefined
): StartWatchPlan => {
  const fallback: StartWatchPlan = settings.startAlertEnabled
    ? { action: 'alert', durationMs: settings.startAlertDelayMs }
    : WATCH_ONLY

  if (!settings.calendarEnabled || meeting === undefined) return fallback

  const durationMs = Math.min(MEETING_START_DELAY_MS, settings.startAlertDelayMs)
  if (settings.autoStartEnabled) return { action: 'auto-start', durationMs, event: meeting }
  if (settings.startAlertEnabled) return { action: 'alert', durationMs, event: meeting }
  return fallback
}
