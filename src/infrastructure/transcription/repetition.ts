/**
 * whisper が陥る繰り返しループを取り除く（ADR-038）。
 *
 * ループした出力はトークンの確信度が高い（実測で平均対数確率 -0.03 前後）ため、
 * 確信度による除外では落とせない。繰り返しという形そのものを手掛かりにする。
 */

/**
 * セグメント内で、同じ語句がこの回数以上続いたらループとみなす。
 *
 * 「はいはいはい」のように人が実際に繰り返す回数より十分に多くしてある。
 * whisper のループはウィンドウのトークン上限まで続くので、この回数には楽に届く。
 */
const MIN_INNER_REPEATS = 8

/** 繰り返しの単位として見る最長の文字数。1 文ぶんの長さがあれば足りる。 */
const MAX_UNIT_LENGTH = 30

const INNER_LOOP = new RegExp(`(.{1,${MAX_UNIT_LENGTH}}?)\\1{${MIN_INNER_REPEATS - 1},}`, 'gu')

const DIGITS_ONLY = /^[\d０-９,，.]+$/u

/**
 * セグメント内のループを 1 回に縮める。`removed` は削った文字（計測用）。
 *
 * セグメントごと落とさずに縮めるのは、ループの前に本物の発言が載っていることがあるため
 * （実測で「木曜の午前中に共有します」の後ろに相づちのループが続いた）。
 */
export const collapseRepeats = (text: string): { text: string; removed: string } => {
  let removed = ''
  const collapsed = text.replace(INNER_LOOP, (run: string, unit: string) => {
    // 「100000000円」の 0 は桁であって繰り返しではない。
    if (DIGITS_ONLY.test(unit)) return run
    removed += run.slice(unit.length)
    return unit
  })
  return { text: collapsed, removed }
}

/**
 * 同じ文がこの数以上続いたらループとみなす。
 *
 * 合成音声で実際に 3 回続けて読ませた相づちは残る数にしてある。ループの実例は
 * 数十回（84 回、60 回）続いたので、ここで取りこぼすことはない。
 */
const MIN_SEGMENT_REPEATS = 4

/**
 * 前のセグメントの終わりからこれ以内に始まれば「続いている」とみなす。
 *
 * ループしたセグメントは前の終わりちょうどから始まる。マイクのトラックには相手の声が
 * 無いので、間を置いた「はい。」が並ぶのは普通のことで、それを巻き込まないための条件。
 */
const MAX_LOOP_GAP_MS = 1000

/** 句読点と空白の揺れで同じ文を別物と見ないよう、比べる前に落とす。 */
const normalize = (text: string): string => text.replace(/[\p{P}\p{Z}\s]/gu, '')

/**
 * 間を空けずに同じ文が続くループを、最初の 1 つだけ残して落とす。
 *
 * 最初の 1 つを残すのは、それがループの種になった本物の発言であることがあるため。
 * 作り話だったとしても 1 行で済み、何十行も続くよりずっと害が小さい。
 */
export const dropRepeatedSegments = <T extends { startMs: number; endMs: number; text: string }>(
  segments: readonly T[]
): { kept: T[]; dropped: T[] } => {
  const runs: T[][] = []
  for (const segment of segments) {
    const run = runs[runs.length - 1]
    const last = run?.[run.length - 1]
    if (
      run &&
      last &&
      normalize(last.text) === normalize(segment.text) &&
      segment.startMs - last.endMs <= MAX_LOOP_GAP_MS
    ) {
      run.push(segment)
    } else {
      runs.push([segment])
    }
  }

  const kept: T[] = []
  const dropped: T[] = []
  for (const run of runs) {
    if (run.length >= MIN_SEGMENT_REPEATS) {
      const [first, ...rest] = run
      if (first) kept.push(first)
      dropped.push(...rest)
    } else {
      kept.push(...run)
    }
  }
  return { kept, dropped }
}
