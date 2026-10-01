import { isRemoteSpeakerId, remoteSpeakerId, type Speaker } from './Speaker'
import type { SpeakerTurn, TranscriptSegment } from './TranscriptSegment'

/** 同一話者の連続セグメントを結合する際に許容する無音の長さ。 */
const DEFAULT_MAX_GAP_MS = 2_000

/**
 * 複数トラック（マイク／システム音声）のセグメントを時系列 1 本にまとめる。
 * 開始時刻が同じ場合は短い発話を先に置き、読み上げ順を安定させる。
 */
export const mergeTracks = (tracks: readonly (readonly TranscriptSegment[])[]): TranscriptSegment[] =>
  tracks.flat().sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)

const overlapMs = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): number =>
  Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs))

/**
 * 相手トラックのセグメントを、時間の重なりが最大となるダイアライゼーション結果の
 * 話者クラスタへ割り当てる。自分トラックは常に確定しているので触らない。
 */
export const applyDiarization = (
  segments: readonly TranscriptSegment[],
  turns: readonly SpeakerTurn[]
): TranscriptSegment[] => {
  if (turns.length === 0) return [...segments]

  return segments.map((segment) => {
    if (!isRemoteSpeakerId(segment.speakerId)) return segment

    let best: SpeakerTurn | undefined
    let bestOverlap = 0
    for (const turn of turns) {
      const overlap = overlapMs(segment, turn)
      if (overlap > bestOverlap) {
        best = turn
        bestOverlap = overlap
      }
    }

    return best ? { ...segment, speakerId: remoteSpeakerId(best.speaker) } : segment
  })
}

/** 同じ話者が続くセグメントを 1 つの発話にまとめ、読みやすさを上げる。 */
export const coalesceSegments = (
  segments: readonly TranscriptSegment[],
  options: { maxGapMs?: number } = {}
): TranscriptSegment[] => {
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS
  const result: TranscriptSegment[] = []

  for (const segment of segments) {
    const previous = result[result.length - 1]
    if (previous && previous.speakerId === segment.speakerId && segment.startMs - previous.endMs <= maxGapMs) {
      result[result.length - 1] = {
        ...previous,
        endMs: segment.endMs,
        text: `${previous.text} ${segment.text}`
      }
      continue
    }
    result.push(segment)
  }

  return result
}

/** ミリ秒を mm:ss（1 時間以上は h:mm:ss）へ整形する。 */
export const formatTimestamp = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  const pad = (value: number): string => String(value).padStart(2, '0')

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** コピペ用の Markdown 文字起こしを生成する。 */
export const toMarkdown = (segments: readonly TranscriptSegment[], speakers: readonly Speaker[]): string => {
  const labels = new Map(speakers.map((speaker) => [speaker.id, speaker.label]))

  return segments
    .map((segment) => {
      const label = labels.get(segment.speakerId) ?? segment.speakerId
      return `**[${formatTimestamp(segment.startMs)}] ${label}**\n${segment.text}`
    })
    .join('\n\n')
}
