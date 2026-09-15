import type { TranscriptSegment } from './TranscriptSegment'

/** 抜粋の中でハイライトする位置。start は抜粋の先頭からの UTF-16 オフセット。 */
export interface HighlightRange {
  readonly start: number
  readonly length: number
}

/** 本文にクエリの語がそろった発言 1 件。 */
export interface TranscriptKeywordMatch {
  readonly startMs: number
  readonly endMs: number
  readonly speakerId: string
  readonly excerpt: string
  readonly ranges: readonly HighlightRange[]
}

/** 抜粋の長さ。意味検索の結果と同じ見た目（2 行程度）に収める。 */
export const EXCERPT_CHARS = 120

/** 該当箇所の前に残す文脈の長さ。前を少しだけ見せて、後ろを長く取る。 */
const LEAD_CHARS = 30

/** 1 件の録音から拾う発言の既定の上限。 */
export const DEFAULT_MATCHES_PER_RECORDING = 3

/**
 * クエリを語に分ける。
 *
 * 全角の空白も区切りにするのは、日本語入力のまま打つと全角になるため。
 * 重複を畳むのは、同じ条件を二重に課してもヒットは変わらないから。
 */
export const parseKeywordQuery = (query: string): string[] => [
  ...new Set(query.split(/[\s　]+/u).filter((term) => term.length > 0))
]

/**
 * 照合用に文字を畳んだ文字列と、その 1 文字ごとの元の位置。
 *
 * NFKC は文字数を変えることがある（`ｶﾞ` の 2 文字が `ガ` の 1 文字になる）ので、
 * 畳んだ文字列の位置をそのままハイライトに使うとずれる。元の位置を併せて持ち、
 * 一致の範囲は必ず元のテキスト側に戻してから切り出す。
 */
interface FoldedText {
  readonly text: string
  /** `origin[i]` = 畳んだ文字列の位置 i に対応する、元のテキストの位置。末尾に番兵を持つ。 */
  readonly origin: readonly number[]
}

const fold = (text: string): FoldedText => {
  let folded = ''
  const origin: number[] = []

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined) break
    const char = String.fromCodePoint(codePoint)
    const normalized = char.normalize('NFKC').toLowerCase()

    for (let offset = 0; offset < normalized.length; offset += 1) origin.push(index)
    folded += normalized
    index += char.length
  }
  origin.push(text.length)

  return { text: folded, origin }
}

/** 畳んだ文字列での一致を、元のテキストの範囲に戻す。 */
const rangesOf = (folded: FoldedText, term: string): HighlightRange[] => {
  const needle = fold(term).text
  if (needle.length === 0) return []

  const ranges: HighlightRange[] = []
  for (let from = folded.text.indexOf(needle); from !== -1; ) {
    const start = folded.origin[from] ?? 0
    const end = folded.origin[from + needle.length] ?? start
    ranges.push({ start, length: end - start })
    from = folded.text.indexOf(needle, from + needle.length)
  }

  return ranges
}

/**
 * 該当箇所の周りだけを切り出す。
 *
 * 発言 1 件が数百文字になることがあり、全部出すと一覧がヒットの数だけ崩れる。
 * 切った側に `…` を付けるのは、その発言の全文ではないと分かるようにするため。
 */
const excerptAround = (
  text: string,
  ranges: readonly HighlightRange[]
): { excerpt: string; ranges: HighlightRange[] } => {
  const first = ranges[0]
  if (!first || text.length <= EXCERPT_CHARS) return { excerpt: text, ranges: [...ranges] }

  // 窓は必ず最初の一致から数えて始める。末尾に寄せて長さを稼ぐと、一覧が抜粋を
  // 2 行で打ち切ったときに当たった語がその外へ落ち、なぜ当たったのかが見えなくなる。
  const from = Math.max(0, first.start - LEAD_CHARS)
  const to = Math.min(text.length, from + EXCERPT_CHARS)
  const head = from > 0 ? '…' : ''
  const tail = to < text.length ? '…' : ''
  const shift = head.length - from

  return {
    excerpt: `${head}${text.slice(from, to)}${tail}`,
    // 切り落とした側にはみ出す一致は、指す先が無いので落とす。
    ranges: ranges
      .filter((range) => range.start >= from && range.start + range.length <= to)
      .map((range) => ({ start: range.start + shift, length: range.length }))
  }
}

/**
 * 文字起こしの本文から、語がすべてそろった発言を拾う。
 *
 * 語を AND で取るのは、1 語で絞りきれないときに語を足して絞り込めるようにするため。
 * 同じ発言の中にそろっていることを条件にするので、拾った発言はそのまま抜粋になる。
 */
export const matchTranscript = (
  segments: readonly TranscriptSegment[],
  terms: readonly string[],
  limit: number = DEFAULT_MATCHES_PER_RECORDING
): TranscriptKeywordMatch[] => {
  if (terms.length === 0 || limit <= 0) return []

  const matches: TranscriptKeywordMatch[] = []
  for (const segment of segments) {
    const folded = fold(segment.text)
    const perTerm = terms.map((term) => rangesOf(folded, term))
    if (perTerm.some((ranges) => ranges.length === 0)) continue

    const sorted = perTerm.flat().sort((left, right) => left.start - right.start)
    const { excerpt, ranges } = excerptAround(segment.text, sorted)
    matches.push({
      startMs: segment.startMs,
      endMs: segment.endMs,
      speakerId: segment.speakerId,
      excerpt,
      ranges
    })
    if (matches.length >= limit) break
  }

  return matches
}
