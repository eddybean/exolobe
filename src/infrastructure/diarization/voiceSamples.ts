import type { SpeakerTurn } from '@domain/TranscriptSegment'

/** 声紋に使う音の範囲。 */
export interface SampleRange {
  readonly startMs: number
  readonly endMs: number
}

/**
 * 声紋に使うターンの最短。
 *
 * 「はい」「なるほど」といった相槌は、声の特徴より前後の無音と語尾の方が支配的で、
 * 混ぜるほど声紋が平均へ寄って誰とも一致しなくなる。
 */
export const MIN_TURN_MS = 1_000

/**
 * 声紋を作るのに要求する合計の長さ。
 *
 * これに満たない話者は声紋を作らない。短い音から作った声紋を登録すると、
 * 次の録音で別人に当たる原因になる。作らなければ「参加者A」のままで済む。
 */
export const MIN_VOICE_MS = 3_000

/**
 * 1 人あたりに使う合計の上限。
 *
 * CampPlus の声紋は 20〜30 秒で頭打ちになる。それ以上渡しても精度は変わらず、
 * 長時間の会議で抽出だけに時間を取られる。
 */
export const MAX_VOICE_MS = 30_000

/**
 * 話者ごとに、声紋を作るのに使う音の範囲を選ぶ。
 *
 * 上限を超える分は長いターンから残す。長く続けて話している区間ほど、
 * 言い淀みや重なりの影響が薄く、その人の声そのものに近い。
 */
export const selectVoiceRanges = (
  turns: readonly SpeakerTurn[],
  options: { minTurnMs?: number; minVoiceMs?: number; maxVoiceMs?: number } = {}
): Map<string, SampleRange[]> => {
  const minTurnMs = options.minTurnMs ?? MIN_TURN_MS
  const minVoiceMs = options.minVoiceMs ?? MIN_VOICE_MS
  const maxVoiceMs = options.maxVoiceMs ?? MAX_VOICE_MS

  const bySpeaker = new Map<string, SampleRange[]>()
  for (const turn of turns) {
    if (turn.endMs - turn.startMs < minTurnMs) continue
    const ranges = bySpeaker.get(turn.speaker) ?? []
    ranges.push({ startMs: turn.startMs, endMs: turn.endMs })
    bySpeaker.set(turn.speaker, ranges)
  }

  const selected = new Map<string, SampleRange[]>()
  for (const [speaker, ranges] of bySpeaker) {
    const kept: SampleRange[] = []
    let total = 0

    for (const range of [...ranges].sort(
      (a, b) => b.endMs - b.startMs - (a.endMs - a.startMs)
    )) {
      if (total >= maxVoiceMs) break
      // 上限をまたぐターンは頭から必要なぶんだけ取る。丸ごと捨てると、
      // 1 本しか長いターンが無い話者で声紋が作れなくなる。
      const take = Math.min(range.endMs - range.startMs, maxVoiceMs - total)
      kept.push({ startMs: range.startMs, endMs: range.startMs + take })
      total += take
    }

    if (total < minVoiceMs) continue
    selected.set(
      speaker,
      kept.sort((a, b) => a.startMs - b.startMs)
    )
  }

  return selected
}
