import type { HighlightRangeDto } from '@shared/ipc'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

/** 抜粋を「当たった部分」と「そうでない部分」に切った断片。 */
export interface ExcerptPiece {
  readonly text: string
  readonly hit: boolean
}

/**
 * 抜粋を、ハイライトする範囲で断片に切る。
 *
 * 語どうしが重なって当たることがある（「予算」と「算案」）ので、先に範囲をまとめる。
 * まとめずに切ると断片の境目が前後し、元の文が並べ替わって見える。
 */
export const splitHighlight = (
  excerpt: string,
  ranges: readonly HighlightRangeDto[]
): ExcerptPiece[] => {
  const merged: { start: number; end: number }[] = []
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    const last = merged[merged.length - 1]
    const end = range.start + range.length
    if (last && range.start <= last.end) last.end = Math.max(last.end, end)
    else merged.push({ start: range.start, end })
  }

  const pieces: ExcerptPiece[] = []
  const push = (text: string, hit: boolean): void => {
    if (text.length > 0) pieces.push({ text, hit })
  }

  let cursor = 0
  for (const range of merged) {
    push(excerpt.slice(cursor, range.start), false)
    push(excerpt.slice(range.start, range.end), true)
    cursor = range.end
  }
  push(excerpt.slice(cursor), false)

  return pieces.length > 0 ? pieces : [{ text: excerpt, hit: false }]
}

/**
 * 検索結果の時刻が、詳細画面のどの発言にあたるかを決める。
 *
 * 結果を出してから話者名の変更などで文字起こしが書き直されると、時刻が
 * ぴったり一致しなくなる。その場合はその時刻を含む手前の発言に寄せて、
 * 「飛んだのにどこにも行かない」を避ける。
 */
export const focusedSegmentIndex = (
  segments: readonly TranscriptSegment[],
  startMs: number
): number => {
  if (segments.length === 0) return -1

  let found = 0
  for (const [index, segment] of segments.entries()) {
    if (segment.startMs > startMs) break
    found = index
  }
  return found
}
