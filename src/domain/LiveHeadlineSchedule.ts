/**
 * 録音中の「今の話題の見出し」をいつ作り直すか（ADR-050）。
 *
 * 見出しは自動で出す唯一の LLM の出力なので、出す頻度で邪魔さが決まる。間隔だけで作ると
 * 話が進んでいないのに同じ見出しを作り直し、話題の切り替わり（間が空く）を待つと
 * 話し続ける会議でいつまでも出ない。両方を見て、どちらの場合も最短の間隔を空ける。
 */

export interface HeadlineScheduleOptions {
  /** 前回からこれだけ経てば作る（設定の headlineIntervalMin）。 */
  readonly intervalMs: number
  /** 前倒しのときも、前回からこれだけは空ける。 */
  readonly minIntervalMs: number
  /** 前回の見出し以降の確定文がこの字数に満たなければ作らない。要点を作るには材料が足りない。 */
  readonly minNewChars: number
  /** 確定文がこれだけ途切れたら、話題の切れ目とみなして前倒しする。 */
  readonly pauseMs: number
}

export const headlineScheduleOptions = (intervalMin: number): HeadlineScheduleOptions => ({
  intervalMs: intervalMin * 60_000,
  minIntervalMs: 90_000,
  minNewChars: 200,
  pauseMs: 8_000
})

export interface HeadlineScheduleInput {
  readonly nowMs: number
  /** 前回の見出しの時刻。まだ作っていなければ録音の開始時刻。 */
  readonly lastHeadlineAtMs: number
  /** 前回の見出し以降に確定した文の字数。 */
  readonly newChars: number
  /** 最後に確定文が届いた時刻。まだ無ければ undefined。 */
  readonly lastFinalAtMs?: number
}

export const isHeadlineDue = (input: HeadlineScheduleInput, options: HeadlineScheduleOptions): boolean => {
  if (input.lastFinalAtMs === undefined || input.newChars < options.minNewChars) return false

  const sinceHeadline = input.nowMs - input.lastHeadlineAtMs
  if (sinceHeadline < options.minIntervalMs) return false
  if (sinceHeadline >= options.intervalMs) return true
  return input.nowMs - input.lastFinalAtMs >= options.pauseMs
}
