import { noteMoments, type Bookmark } from '@domain/MeetingNotes'
import type { TranscriptSegment } from '@domain/TranscriptSegment'
import type { RecordingStatus } from '@domain/Recording'
import type { TransportStateDto } from '@shared/ipc'
import { focusedSegmentIndex } from './transcriptSearch'

/**
 * 詳細画面を録音中の画面（メーター・印・会議中メモ）に置き換えるか。
 *
 * 録音の状態だけでは決めない。止めた直後は一覧の更新より先に transport が止まるので、
 * そちらを見て即座に通常の詳細へ戻す。落ちて「録音中」のまま残った録音も、
 * 今録っているものでなければ通常の詳細で開く。
 */
export const showsLiveView = (
  recording: { readonly id: string; readonly status: RecordingStatus },
  transport: Pick<TransportStateDto, 'active' | 'recordingId'>
): boolean => recording.status === 'recording' && transport.active && transport.recordingId === recording.id

/**
 * 録音が始まったときに開く録音。始まった瞬間だけ返し、録音中の状態の更新では返さない。
 * 録音中に利用者が別の録音を開いて読み返していても、それを奪わないため。
 */
export const recordingToOpen = (
  previous: Pick<TransportStateDto, 'active' | 'recordingId'>,
  next: Pick<TransportStateDto, 'active' | 'recordingId'>
): string | undefined => {
  if (!next.active || next.recordingId === undefined) return undefined
  const started = !previous.active || previous.recordingId !== next.recordingId
  return started ? next.recordingId : undefined
}

export interface DetailMoment {
  readonly kind: 'note' | 'bookmark'
  readonly atMs: number
  readonly text: string
}

/** 詳細画面のメモ欄に出す「時刻から飛ぶ」一覧。メモの行と印を時刻順に混ぜる。 */
export const detailMoments = (note: string, bookmarks: readonly Bookmark[]): DetailMoment[] =>
  [
    ...noteMoments(note).map((moment) => ({ kind: 'note' as const, ...moment })),
    ...bookmarks.map(({ atMs }) => ({ kind: 'bookmark' as const, atMs, text: '' }))
  ].sort((a, b) => a.atMs - b.atMs)

/**
 * 印がついた発言。押した時点で話されていた（合間なら直前の）発言に付ける。
 * 検索から飛ぶときと同じ寄せ方にして、同じ時刻なら同じ発言を指すようにする。
 */
export const bookmarkedSegmentIndexes = (
  segments: readonly TranscriptSegment[],
  bookmarks: readonly Bookmark[]
): Set<number> =>
  new Set(bookmarks.map(({ atMs }) => focusedSegmentIndex(segments, atMs)).filter((index) => index >= 0))

/**
 * 録音中の画面のメーターで点ける段数。
 * peak は線形の振幅で、話し声は 0.1〜0.3 あたりに収まる。そのままだと端の数段しか
 * 動かず「録れていない」ように見えるので、平方根で持ち上げてから段に割る。
 */
export const litSegments = (level: number, count: number): number =>
  Math.min(count, Math.round(Math.sqrt(Math.max(0, level)) * count))
