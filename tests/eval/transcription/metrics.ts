/**
 * 文字起こしの評価指標。正解（いつ何を言ったか）と whisper の出力を突き合わせる。
 *
 * 施策の前後を比べるための相対的な物差しで、絶対値に意味を持たせない。
 * 「三社」と「3社」のような表記の揺れは誤りに数えてしまうが、前後で同じだけ効く。
 */

/** 句読点・空白・全角半角の揺れを落とす。比べたいのは言葉で、書き方ではない。 */
export const normalizeText = (text: string): string =>
  text.normalize('NFKC').replace(/[\p{P}\p{S}\p{Z}\s]/gu, '')

const editDistance = (a: readonly string[], b: readonly string[]): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (const [i, charA] of a.entries()) {
    const current = [i + 1]
    for (const [j, charB] of b.entries()) {
      current.push(
        Math.min(
          (previous[j + 1] ?? 0) + 1,
          (current[j] ?? 0) + 1,
          (previous[j] ?? 0) + (charA === charB ? 0 : 1)
        )
      )
    }
    previous = current
  }
  return previous[b.length] ?? 0
}

/** 発言 1 つ。正解（台本）と whisper の出力の両方をこの形で扱う。 */
export interface TimedText {
  readonly startMs: number
  readonly endMs: number
  readonly text: string
}

/**
 * 発話の端からこれ以内のずれは、発話に重なっているとみなす。
 * whisper の時刻は、読み上げの無音の頭や尻尾のぶん数百ミリ秒ずれる。
 */
const EDGE_TOLERANCE_MS = 1000

const overlaps = (a: TimedText, b: TimedText, toleranceMs = 0): boolean =>
  a.startMs < b.endMs + toleranceMs && b.startMs < a.endMs + toleranceMs

/** 発話の無い区間に出たセグメントの文字数。無音や雑音から生まれた作り話の量。 */
export const hallucinatedChars = (
  said: readonly TimedText[],
  output: readonly TimedText[]
): number =>
  output
    .filter((segment) => !said.some((utterance) => overlaps(utterance, segment, EDGE_TOLERANCE_MS)))
    .reduce((sum, segment) => sum + [...normalizeText(segment.text)].length, 0)

const commonSubsequenceLength = (a: readonly string[], b: readonly string[]): number => {
  let previous = new Array<number>(b.length + 1).fill(0)
  for (const charA of a) {
    const current = [0]
    for (const [j, charB] of b.entries()) {
      current.push(
        charA === charB
          ? (previous[j] ?? 0) + 1
          : Math.max(previous[j + 1] ?? 0, current[j] ?? 0)
      )
    }
    previous = current
  }
  return previous[b.length] ?? 0
}

/** 発話の言葉がこの割合以上、重なる出力に残っていれば拾えたとみなす。 */
const MIN_RECALL = 0.5

/**
 * 取りこぼした発話の数。
 *
 * 時刻が重なる出力があるかだけでは判定しない。ループした出力は本物の発話の時刻を
 * 覆ったまま別の文を並べるので、言葉が残っているかまで見る。
 */
export const missedUtterances = (
  said: readonly TimedText[],
  output: readonly TimedText[]
): number =>
  said.filter((utterance) => {
    const expected = [...normalizeText(utterance.text)]
    if (expected.length === 0) return false
    const heard = [
      ...normalizeText(
        output
          .filter((segment) => overlaps(utterance, segment, EDGE_TOLERANCE_MS))
          .map((segment) => segment.text)
          .join('')
      )
    ]
    return commonSubsequenceLength(expected, heard) / expected.length < MIN_RECALL
  }).length

/** 同じ文（句読点の揺れは無視）が続いた最長の数。ループの長さの目安。 */
export const longestRepeatRun = (output: readonly TimedText[]): number => {
  let longest = 0
  let run = 0
  let previous: string | undefined
  for (const segment of output) {
    const text = normalizeText(segment.text)
    run = text === previous ? run + 1 : 1
    previous = text
    longest = Math.max(longest, run)
  }
  return longest
}

/** 文字誤り率。正解が空なら、出力の文字数そのもの（何も言っていないのに出た分）。 */
export const characterErrorRate = (reference: string, hypothesis: string): number => {
  const ref = [...normalizeText(reference)]
  const hyp = [...normalizeText(hypothesis)]
  if (ref.length === 0) return hyp.length
  return editDistance(ref, hyp) / ref.length
}
