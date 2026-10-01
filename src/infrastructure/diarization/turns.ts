import type { SpeakerTurn } from '@domain/TranscriptSegment'

/**
 * 話者数を上限まで絞る。
 *
 * sherpa-onnx の閾値クラスタリングは話者数を指定できず、雑音や短い相槌で
 * 実際より多くのクラスタを作ることがある。発話時間の合計が長い話者から順に
 * 上限まで残し、あふれた分のターンは捨てる。捨てられた区間に重なるセグメントは
 * どのターンとも重ならなくなるため、汎用の「参加者」ラベルのままになる。
 */
export const limitSpeakers = (turns: readonly SpeakerTurn[], maxSpeakers: number): SpeakerTurn[] => {
  if (maxSpeakers <= 0) return [...turns]

  const durationBySpeaker = new Map<string, number>()
  for (const turn of turns) {
    const duration = Math.max(0, turn.endMs - turn.startMs)
    durationBySpeaker.set(turn.speaker, (durationBySpeaker.get(turn.speaker) ?? 0) + duration)
  }

  if (durationBySpeaker.size <= maxSpeakers) return [...turns]

  const kept = new Set(
    [...durationBySpeaker.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, maxSpeakers)
      .map(([speaker]) => speaker)
  )

  return turns.filter((turn) => kept.has(turn.speaker))
}
