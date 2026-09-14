import { REMOTE_SPEAKER_ID } from './Speaker'
import type { SpeakerTurn, TranscriptSegment } from './TranscriptSegment'

/**
 * 完了した文字起こしから、声紋を取り直すためのターンを組み直す。
 *
 * 話者クラスタの割り当ては `transcript.json` に残っているので、声紋を作り直すのに
 * 話者識別をやり直す必要はない。やり直すとクラスタ番号が振り直され、利用者が見ている
 * 話者の並びと既に付けた名前の対応が崩れる。
 *
 * 入力の音は `audio.m4a`、つまり自分と相手をミックスした 1 本になる。パイプラインが
 * 話者識別に使う `system.wav`（相手だけ）は完了時に捨てているため、後からは手に入らない。
 * そこで自分が喋っていた区間を引いて、相手の声だけを残す。誰がいつ喋ったかは
 * 文字起こしの時点で確定しているので、推定は要らない。
 */

/**
 * 自分の発話を前後に広げる幅。
 *
 * 文字起こしが返す時刻は発話の端で数十ミリ秒ぶれ、AAC のプライミングぶんも乗る。
 * 端を残すと相槌の頭や尻尾が相手の声紋に混ざるので、少し広めに引く。相手のターンは
 * 十数秒あれば足りる（`selectVoiceRanges`）ため、削りすぎる心配より混ざる害が大きい。
 */
export const VOICE_TURN_GUARD_MS = 200

const CLUSTER_PREFIX = `${REMOTE_SPEAKER_ID}:`

interface Span {
  readonly startMs: number
  readonly endMs: number
}

export const voiceTurnsFromTranscript = (
  segments: readonly TranscriptSegment[]
): SpeakerTurn[] => {
  const muted = mergeSpans(
    segments
      .filter((segment) => !segment.speakerId.startsWith(CLUSTER_PREFIX))
      .map((segment) => ({
        startMs: segment.startMs - VOICE_TURN_GUARD_MS,
        endMs: segment.endMs + VOICE_TURN_GUARD_MS
      }))
  )

  return segments.flatMap((segment) => {
    // クラスタの付いていない裸の `remote` は捨てる。話者が分かれていない録音で、
    // 複数人を混ぜた 1 本を誰かの声として覚えると、次の録音で取り違える。
    if (!segment.speakerId.startsWith(CLUSTER_PREFIX)) return []
    const speaker = segment.speakerId.slice(CLUSTER_PREFIX.length)
    if (speaker.length === 0) return []

    return subtract(segment, muted).map((span) => ({ speaker, ...span }))
  })
}

/** 重なり合う区間をまとめ、引き算を 1 回で済ませられる形にする。 */
const mergeSpans = (spans: readonly Span[]): Span[] => {
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs)
  const merged: Span[] = []

  for (const span of sorted) {
    const previous = merged[merged.length - 1]
    if (previous && span.startMs <= previous.endMs) {
      merged[merged.length - 1] = {
        startMs: previous.startMs,
        endMs: Math.max(previous.endMs, span.endMs)
      }
      continue
    }
    merged.push(span)
  }

  return merged
}

/** `span` から `muted` の各区間を引き、残った断片を返す。 */
const subtract = (span: Span, muted: readonly Span[]): Span[] => {
  let rest: Span[] = [{ startMs: span.startMs, endMs: span.endMs }]

  for (const cut of muted) {
    rest = rest.flatMap((piece) => {
      if (cut.endMs <= piece.startMs || cut.startMs >= piece.endMs) return [piece]

      const head = { startMs: piece.startMs, endMs: Math.min(piece.endMs, cut.startMs) }
      const tail = { startMs: Math.max(piece.startMs, cut.endMs), endMs: piece.endMs }

      return [head, tail].filter((part) => part.endMs > part.startMs)
    })
  }

  return rest
}
