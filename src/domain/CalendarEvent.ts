/**
 * 録音の開始時刻に重なるカレンダーの予定（ADR-040）。
 *
 * 予定のタイトルを録音タイトルの初期値に、参加者名を話者リネームの候補にする。
 * どの予定を「この録音の会議」とみなすかは推定なので、ここで外しても
 * 失うのは初期値だけになるよう、結果は必ず後から直せる場所にしか使わない。
 */

export type AttendeeStatus = 'accepted' | 'declined' | 'tentative' | 'pending' | 'unknown'

/** 人か、会議室・設備などの人でないものか。後者は話者になり得ない。 */
export type AttendeeKind = 'person' | 'room' | 'resource' | 'group' | 'unknown'

export interface CalendarAttendee {
  readonly name?: string | undefined
  readonly email?: string | undefined
  /** カレンダーの持ち主本人か。本人の名前は「自分」トラックが既に表している。 */
  readonly isSelf: boolean
  readonly status: AttendeeStatus
  readonly kind: AttendeeKind
}

export interface CalendarEvent {
  readonly title: string
  readonly startsAt: Date
  readonly endsAt: Date
  readonly allDay: boolean
  readonly attendees: readonly CalendarAttendee[]
}

/**
 * 予定の開始前でも、この時間内に録音を始めたならその予定とみなす。
 *
 * 会議の数分前に接続して録音を始めるのはよくある。逆に広げすぎると、
 * 直前の会議を延長して録っているのに次の予定の名前が付いてしまう。
 */
export const EARLY_START_MARGIN_MS = 5 * 60_000

const isDeclinedBySelf = (event: CalendarEvent): boolean =>
  event.attendees.some((attendee) => attendee.isSelf && attendee.status === 'declined')

/**
 * 録音開始時刻に対応する予定を 1 件選ぶ。無ければ undefined。
 *
 * 重なる予定が複数ある場合は、開始時刻が録音開始に最も近いものを選ぶ。
 * 長い「作業枠」の中で別の会議が始まったとき、録っているのは後者であることが多い。
 */
export const pickEventForRecording = (
  events: readonly CalendarEvent[],
  startedAt: Date
): CalendarEvent | undefined => {
  const at = startedAt.getTime()
  const candidates = events.filter(
    (event) =>
      !event.allDay &&
      !isDeclinedBySelf(event) &&
      event.startsAt.getTime() - EARLY_START_MARGIN_MS <= at &&
      at < event.endsAt.getTime()
  )

  const distance = (event: CalendarEvent): number => Math.abs(event.startsAt.getTime() - at)
  return candidates.reduce<CalendarEvent | undefined>(
    (best, event) => (best === undefined || distance(event) < distance(best) ? event : best),
    undefined
  )
}

const displayName = (attendee: CalendarAttendee): string => {
  const name = attendee.name?.trim()
  if (name) return name
  // 社外の参加者は名前が同期されずメールアドレスしか無いことが多い。
  // 候補として出すだけなので、@ より前を残せば誰かの見当は付く。
  return attendee.email?.split('@')[0]?.trim() ?? ''
}

/** 話者名の候補になる参加者名。自分・会議室や設備・辞退した人は除く。 */
export const participantNames = (event: CalendarEvent): string[] => {
  const names = event.attendees
    .filter((attendee) => !attendee.isSelf && attendee.kind === 'person' && attendee.status !== 'declined')
    .map(displayName)
    .filter((name) => name.length > 0)

  return [...new Set(names)]
}
