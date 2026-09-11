import type { Speaker } from '@domain/Speaker'
import type { SearchSettings } from '@domain/Settings'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

/**
 * 意味検索（自然文のクエリで録音を探す）のための純粋な計算。
 *
 * 録音の中身をどう切ってベクトル化し、どう順位付けるかをここに閉じる。
 * 埋め込みの計算そのものと索引の保存は port の向こう側の仕事。
 */

/**
 * 検索の対象。
 *
 * タイトルは含めない。「採用面接の打ち合わせ」のような短いタイトルは、クエリの
 * 「〜をしたミーティング」の部分とだけで強く一致し、録音ごとに最もよく合うチャンクを
 * 代表にする順位付けでは本文の該当箇所より上に来てしまう（実測で「天気の話」が
 * 天気の話をしていない会議にタイトルで当たった）。タイトルはキーワード検索で探せる。
 */
export type SearchSource = 'summary' | 'note' | 'transcript'

/**
 * チャンクが元の成果物のどこに当たるか。
 *
 * 索引には本文を複製せず位置だけを持つ。録音の削除で本文が確実に消え、
 * 話者名の変更も抜粋にすぐ反映されるようにするため。
 */
export type ChunkLocator =
  /** 文字起こしのセグメント番号の範囲 [from, to)。 */
  | { readonly kind: 'segments'; readonly from: number; readonly to: number }
  /** 要約・メモの文字範囲 [start, end)。 */
  | { readonly kind: 'range'; readonly start: number; readonly end: number }

export interface SearchDocument {
  readonly source: SearchSource
  /** 埋め込みに渡す文字列。 */
  readonly text: string
  readonly locator: ChunkLocator
}

/**
 * 1 チャンクの上限文字数。
 *
 * 日本語 160 字は bge-m3 で約 90 トークン、会議なら 20〜40 秒ほどの発言。
 * 長くするほど 1 本のベクトルに複数の話題が混ざり、雑談のような短い話題が薄まって
 * 当たらなくなる。実測では、業務の話に 3 発言の雑談が挟まった会議で「天気の話」の
 * スコアが、1 チャンク丸ごとなら 0.57、160 字で重ねて切れば 0.65 まで上がった。
 * 結果一覧の抜粋（EXCERPT_CHARS）に近い長さにしてあるので、当たった箇所が
 * そのまま抜粋として見える。250 字では窓の先頭しか見えず、当たった理由が隠れた。
 * 容量は量子化込みで 1 時間あたり約 350KB（120 字にすると約 700KB）。
 */
export const MAX_CHUNK_CHARS = 160

const speakerLine = (segment: TranscriptSegment, labels: ReadonlyMap<string, string>): string =>
  `${labels.get(segment.speakerId) ?? segment.speakerId}: ${segment.text.trim()}`

const sliceByLength = (text: string, maxChars: number): string[] => {
  const slices: string[] = []
  for (let offset = 0; offset < text.length; offset += maxChars) {
    slices.push(text.slice(offset, offset + maxChars))
  }
  return slices
}

/**
 * 文字起こしを「話者名: 発言」の行で束ねる。
 *
 * 話者名を含めるのは「田中さんが予算の話をした会議」のような問いに答えるため。
 * 窓は半分ずつ重ねてずらす。区切りをまたいだ短い話題が 2 つの窓に割れて
 * どちらでも薄まる、ということを避けるため。チャンク数はおよそ倍になるが、
 * 保存時に量子化するので容量は抑えられる。
 */
export const chunkTranscript = (
  segments: readonly TranscriptSegment[],
  speakers: readonly Speaker[],
  maxChars: number = MAX_CHUNK_CHARS
): SearchDocument[] => {
  const labels = new Map(speakers.map((speaker) => [speaker.id, speaker.label]))
  const lines = segments.flatMap((segment, index) =>
    segment.text.trim() ? [{ index, text: speakerLine(segment, labels) }] : []
  )
  const chunks: SearchDocument[] = []

  let start = 0
  while (start < lines.length) {
    // 行の間の改行 1 字も数えて、上限に収まるだけ行を足す。
    let end = start
    let length = 0
    while (end < lines.length) {
      const added = (end === start ? 0 : 1) + (lines[end]?.text.length ?? 0)
      if (end > start && length + added > maxChars) break
      length += added
      end += 1
    }

    const window = lines.slice(start, end)
    const first = window[0]
    const last = window.at(-1)
    if (!first || !last) break
    const locator = { kind: 'segments' as const, from: first.index, to: last.index + 1 }

    // 1 発言だけで上限を超えるなら、同じ位置のまま文字数で分ける。
    const texts =
      window.length === 1 && first.text.length > maxChars
        ? sliceByLength(first.text, maxChars)
        : [window.map((line) => line.text).join('\n')]
    for (const text of texts) chunks.push({ source: 'transcript', text, locator })

    if (end >= lines.length) break
    start += Math.ceil(window.length / 2)
  }

  return chunks
}

interface Span {
  readonly start: number
  readonly end: number
}

/** 空行で区切った段落の範囲。前後の空白は範囲に含めない。 */
const paragraphsOf = (text: string): Span[] => {
  const spans: Span[] = []
  const add = (rawStart: number, rawEnd: number): void => {
    let start = rawStart
    let end = rawEnd
    while (start < end && /\s/.test(text.charAt(start))) start += 1
    while (end > start && /\s/.test(text.charAt(end - 1))) end -= 1
    if (start < end) spans.push({ start, end })
  }

  let cursor = 0
  for (const match of text.matchAll(/\n\s*\n/g)) {
    add(cursor, match.index)
    cursor = match.index + match[0].length
  }
  add(cursor, text.length)

  return spans
}

/** 要約・メモを段落単位で束ねる。見出しと本文が別チャンクに泣き別れしにくくする。 */
export const chunkText = (
  source: Exclude<SearchSource, 'transcript'>,
  text: string,
  maxChars: number = MAX_CHUNK_CHARS
): SearchDocument[] => {
  const spans: Span[] = []
  let current: Span | undefined

  for (const paragraph of paragraphsOf(text)) {
    if (paragraph.end - paragraph.start > maxChars) {
      if (current) spans.push(current)
      current = undefined
      for (let start = paragraph.start; start < paragraph.end; start += maxChars) {
        spans.push({ start, end: Math.min(start + maxChars, paragraph.end) })
      }
      continue
    }

    if (current && paragraph.end - current.start > maxChars) {
      spans.push(current)
      current = undefined
    }
    current = current ? { start: current.start, end: paragraph.end } : paragraph
  }
  if (current) spans.push(current)

  return spans.map(({ start, end }) => ({
    source,
    text: text.slice(start, end),
    locator: { kind: 'range', start, end }
  }))
}

/** 1 件の録音を検索対象の文書群に展開する。 */
export interface SearchMaterial {
  readonly segments: readonly TranscriptSegment[]
  readonly speakers: readonly Speaker[]
  readonly summary: string | undefined
  readonly note: string
}

export const buildSearchDocuments = (material: SearchMaterial): SearchDocument[] => [
  ...chunkText('summary', material.summary ?? ''),
  ...chunkText('note', material.note),
  ...chunkTranscript(material.segments, material.speakers)
]

/**
 * 索引の形式。チャンクの切り方や埋め込みへの渡し方を変えたら上げる。
 * fingerprint に含まれるので、上げるだけで既存の索引が作り直しの対象になる。
 */
export const INDEX_FORMAT_VERSION = 1

/** cyrb53。暗号強度は要らず、node:crypto に頼らずドメインに置ける速いハッシュで足りる。 */
const cyrb53 = (text: string, seed: number): number => {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2_654_435_761)
    h2 = Math.imul(h2 ^ code, 1_597_334_677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909)
  return 4_294_967_296 * (2_097_151 & h2) + (h1 >>> 0)
}

/**
 * 索引が今の録音の内容とモデルに対応しているかを判定するための値。
 *
 * 変更を知らせる経路（メモ編集・再要約・話者名変更…）を漏れなく追うより、
 * 同期のたびに中身から計算して比べる方が取りこぼしが無い。
 */
export const fingerprint = (modelKey: string, documents: readonly SearchDocument[]): string => {
  const payload = JSON.stringify([INDEX_FORMAT_VERSION, modelKey, documents])
  // 衝突すると更新を見逃すため、種を変えた 2 本をつないで 106 ビットにする。
  return cyrb53(payload, 1).toString(16) + cyrb53(payload, 2).toString(16)
}

/**
 * 長さ 1 に揃える。揃えておけば類似度は内積だけで求まる。
 * ゼロベクトルは NaN を生まないようそのまま返す。
 */
export const normalize = (vector: ArrayLike<number>): Float32Array => {
  const result = Float32Array.from(vector)
  let sum = 0
  for (const value of result) sum += value * value
  const length = Math.sqrt(sum)
  if (length === 0) return result

  for (let index = 0; index < result.length; index += 1) {
    result[index] = (result[index] ?? 0) / length
  }
  return result
}

export const dot = (a: Float32Array, b: Float32Array): number => {
  let sum = 0
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) sum += (a[index] ?? 0) * (b[index] ?? 0)
  return sum
}

/**
 * 実測（bge-m3 Q8_0、日本語の会議の発言と自然文クエリ）に基づく足切り。
 *
 * 関連する発言は 0.58〜0.66、無関係なものでも 0.4〜0.53 が出る。クエリの
 * 「〜をしたミーティング」のような言い回しが全体を底上げするため、絶対値だけでは
 * 切れない。首位からの差でも切り、無関係な録音がずらりと並ぶのを防ぐ。
 */
export const DEFAULT_MIN_SCORE = 0.5
export const DEFAULT_SCORE_MARGIN = 0.08
export const DEFAULT_SEARCH_LIMIT = 20

export interface RankedHit<C> {
  readonly recordingId: string
  readonly score: number
  /** その録音で最もよく合ったチャンク。抜粋の元になる。 */
  readonly chunk: C
}

export const rankRecordings = <C extends { readonly vector: Float32Array }>(
  query: Float32Array,
  entries: readonly { readonly recordingId: string; readonly chunks: readonly C[] }[],
  options: { limit?: number; minScore?: number; margin?: number } = {}
): RankedHit<C>[] => {
  const {
    limit = DEFAULT_SEARCH_LIMIT,
    minScore = DEFAULT_MIN_SCORE,
    margin = DEFAULT_SCORE_MARGIN
  } = options

  const best: RankedHit<C>[] = []
  for (const { recordingId, chunks } of entries) {
    let top: RankedHit<C> | undefined
    for (const chunk of chunks) {
      const score = dot(query, chunk.vector)
      if (!top || score > top.score) top = { recordingId, score, chunk }
    }
    if (top) best.push(top)
  }

  best.sort((a, b) => b.score - a.score)
  const leader = best[0]?.score ?? 0

  return best
    .filter((hit) => hit.score >= minScore && hit.score >= leader - margin)
    .slice(0, limit)
}

/** 結果一覧に添える抜粋の既定の長さ。一覧で 2 行程度に収まる量。 */
export const EXCERPT_CHARS = 120

const plainText = (markdown: string): string =>
  markdown
    .replace(/^\s*#+\s*/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()

const truncate = (text: string, maxChars: number): string =>
  text.length > maxChars ? `${text.slice(0, maxChars)}…` : text

/**
 * ヒットしたチャンクの位置から、いまの成果物を切り出して抜粋にする。
 *
 * 索引を作ってから内容が変わっている（次の同期がまだ）こともあるので、
 * 範囲外は空として扱い、検索そのものは失敗させない。
 */
export const excerptFor = (
  source: SearchSource,
  locator: ChunkLocator,
  material: SearchMaterial,
  maxChars: number = EXCERPT_CHARS
): { excerpt: string; startMs?: number } => {
  switch (locator.kind) {
    case 'range': {
      const text = source === 'summary' ? (material.summary ?? '') : material.note
      return { excerpt: truncate(plainText(text.slice(locator.start, locator.end)), maxChars) }
    }
    case 'segments': {
      const labels = new Map(material.speakers.map((speaker) => [speaker.id, speaker.label]))
      const segments = material.segments.slice(locator.from, locator.to)
      const excerpt = truncate(
        plainText(segments.map((segment) => speakerLine(segment, labels)).join(' ')),
        maxChars
      )
      const first = segments[0]
      return first ? { excerpt, startMs: first.startMs } : { excerpt }
    }
  }
}

export type SearchIndexTransition = 'clear' | 'rebuild' | 'sync' | 'none'

/**
 * 設定の変更が索引に何を求めるか。
 *
 * 無効にしたら消すのは、使わない機能のために容量を取り続けないため。
 * モデルの差し替えはワーカーが読み込み済みのモデルを捨てる必要があるので、
 * 単なる同期と区別する（索引自体は fingerprint の不一致で作り直される）。
 */
export const searchIndexTransition = (
  before: SearchSettings,
  after: SearchSettings
): SearchIndexTransition => {
  if (before.enabled && !after.enabled) return 'clear'
  if (!before.enabled && after.enabled) return 'sync'
  if (after.enabled && before.modelPath !== after.modelPath) return 'rebuild'
  return 'none'
}
