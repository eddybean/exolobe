import { SELF_SPEAKER_ID, type Speaker } from '@domain/Speaker'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

/** 話者の色の数。styles.css の `--tone-0` 〜 `--tone-5` と対応する。 */
export const SPEAKER_TONE_COUNT = 6

/**
 * 発言の間の無音で、直前の発言の強調を残しておく長さ。文の切れ目ごとに強調が
 * 消えて点滅するのを避けつつ、長く黙っている間に古い発言を指し続けない長さ。
 */
const GAP_HOLD_MS = 1_500

/** 追従のときに、今の発言を置く位置（表示域の上から）。続きの発言も見えるように上寄せにする。 */
const FOLLOW_ANCHOR = 1 / 3

export interface TimelineSpan {
  readonly startMs: number
  readonly endMs: number
}

/** タイムラインの 1 段。1 話者の発言の区間を並べる。 */
export interface SpeakerLane {
  readonly speakerId: string
  readonly label: string
  readonly spans: readonly TimelineSpan[]
}

/**
 * 話者ごとの色の番号。文字起こしの話者名と帯で同じ番号を使う。
 *
 * 自分は常に 0 番にする。どの録音を開いても自分の色が変わらなければ、色を見ただけで
 * 自分の発言を拾える。相手は話者の並び順（識別の結果の順）に 1 番から振り、
 * 足りなければ 1 番から巡回する — 0 番に戻すと自分と見分けられなくなる。
 */
export const speakerTones = (
  speakers: readonly Speaker[],
  toneCount: number = SPEAKER_TONE_COUNT
): Map<string, number> => {
  const tones = new Map<string, number>()
  let remote = 0
  for (const speaker of speakers) {
    if (speaker.id === SELF_SPEAKER_ID) {
      tones.set(speaker.id, 0)
      continue
    }
    tones.set(speaker.id, 1 + (remote % (toneCount - 1)))
    remote += 1
  }
  return tones
}

/** タイムラインの全長。文字起こしの時刻が録音の長さを僅かに越えることがあり、帯をはみ出させない。 */
export const timelineDurationMs = (
  durationMs: number,
  segments: readonly TranscriptSegment[]
): number => segments.reduce((longest, segment) => Math.max(longest, segment.endMs), durationMs)

/**
 * 話者ごとの段。自分を先頭に、相手は話し始めた順に並べる。
 * 会議の流れを上から読むと「誰が口火を切ったか」が段の順に表れる。
 */
export const speakerLanes = (
  segments: readonly TranscriptSegment[],
  speakers: readonly Speaker[]
): SpeakerLane[] => {
  const labels = new Map(speakers.map((speaker) => [speaker.id, speaker.label]))
  const spansBySpeaker = new Map<string, TimelineSpan[]>()
  for (const segment of [...segments].sort((left, right) => left.startMs - right.startMs)) {
    const spans = spansBySpeaker.get(segment.speakerId) ?? []
    spans.push({ startMs: segment.startMs, endMs: segment.endMs })
    spansBySpeaker.set(segment.speakerId, spans)
  }

  const ids = [...spansBySpeaker.keys()].sort(
    (left, right) => Number(right === SELF_SPEAKER_ID) - Number(left === SELF_SPEAKER_ID)
  )
  return ids.map((speakerId) => ({
    speakerId,
    label: labels.get(speakerId) ?? speakerId,
    spans: spansBySpeaker.get(speakerId) ?? []
  }))
}

/**
 * 再生位置で「今の発言」にあたる文字起こしの行。無ければ -1。
 *
 * 2 トラックの録音では自分と相手の発言が重なる。そのときは後から話し始めた方
 * （割り込んだ側）を返す — 長い発言の途中の相づちを見失わないため。
 */
export const activeSegmentIndex = (
  segments: readonly TranscriptSegment[],
  positionMs: number
): number => {
  let speaking: { index: number; startMs: number } | undefined
  let ended: { index: number; endMs: number } | undefined
  for (const [index, { startMs, endMs }] of segments.entries()) {
    if (startMs > positionMs) continue
    if (positionMs < endMs) {
      if (!speaking || startMs >= speaking.startMs) speaking = { index, startMs }
    } else if (!ended || endMs >= ended.endMs) {
      ended = { index, endMs }
    }
  }
  if (speaking) return speaking.index
  return ended && positionMs - ended.endMs < GAP_HOLD_MS ? ended.index : -1
}

/**
 * 段を押した位置から、どこへ飛ぶかを決める。
 *
 * 帯の上なら発言の頭へ飛ぶ。帯は細く、狙った位置は発言の途中になりやすいが、
 * 聞きたいのは発言の中身で、言いかけの途中から聞かされても分からない。
 */
export const seekTargetMs = (
  spans: readonly TimelineSpan[],
  fraction: number,
  durationMs: number
): number => {
  const positionMs = Math.min(durationMs, Math.max(0, fraction * durationMs))
  const hit = spans.find((span) => span.startMs <= positionMs && positionMs < span.endMs)
  return hit ? hit.startMs : positionMs
}

/**
 * 今の発言を見える位置へ送るときの scrollTop。見えていれば undefined（動かさない）。
 *
 * 見えている間は動かさないのは、再生しながら少し先を読んでいる利用者から
 * 読んでいる位置を奪わないため。
 */
export const followScrollTop = ({
  scrollTop,
  viewHeight,
  itemTop,
  itemHeight
}: {
  readonly scrollTop: number
  readonly viewHeight: number
  readonly itemTop: number
  readonly itemHeight: number
}): number | undefined => {
  const visible = itemTop >= scrollTop && itemTop + itemHeight <= scrollTop + viewHeight
  if (visible) return undefined
  return Math.max(0, itemTop - viewHeight * FOLLOW_ANCHOR)
}
