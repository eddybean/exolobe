/** 波形に出す入力レベルの履歴（フッターの操作バー用）。 */

export interface LevelSample {
  /** マイクが取れていなければ undefined（無音の 0 とは区別して出す）。 */
  readonly mic: number | undefined
  readonly system: number
}

/** 100ms ごとに 100 個 = 直近 10 秒。 */
export const LEVEL_SAMPLE_INTERVAL_MS = 100
export const LEVEL_HISTORY_CAPACITY = 100

export const pushLevel = (
  history: readonly LevelSample[],
  sample: LevelSample,
  capacity: number
): readonly LevelSample[] => [...history, sample].slice(-capacity)

/**
 * peak（0〜1）を、中央線から伸ばす棒の高さ（px）にする。
 * 話し声の peak は小さく出るので平方根で持ち上げる（litSegments と同じ）。
 * 無音でも minPx は残し、録れていない状態と見分けられるようにする。
 */
export const barHeight = (peak: number, halfHeightPx: number, minPx: number): number =>
  Math.max(minPx, Math.sqrt(Math.min(1, Math.max(0, peak))) * halfHeightPx)
