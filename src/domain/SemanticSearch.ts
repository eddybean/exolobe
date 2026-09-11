import type { Speaker } from '@domain/Speaker'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

/**
 * 意味検索（自然文のクエリで録音を探す）のための純粋な計算。
 *
 * 録音の中身をどう切ってベクトル化し、どう順位付けるかをここに閉じる。
 * 埋め込みの計算そのものと索引の保存は port の向こう側の仕事。
 */

export type SearchSource = 'title' | 'summary' | 'note' | 'transcript'

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
  | { readonly kind: 'whole' }

export interface SearchDocument {
  readonly source: SearchSource
  /** 埋め込みに渡す文字列。 */
  readonly text: string
  readonly locator: ChunkLocator
}

/**
 * 1 チャンクの上限文字数。
 *
 * 日本語 500 字は bge-m3 で約 270 トークン。長くするほど 1 本のベクトルに複数の
 * 話題が混ざり、雑談のような短い話題が薄まって当たらなくなる。
 */
export const MAX_CHUNK_CHARS = 500

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
 */
export const chunkTranscript = (
  segments: readonly TranscriptSegment[],
  speakers: readonly Speaker[],
  maxChars: number = MAX_CHUNK_CHARS
): SearchDocument[] => {
  const labels = new Map(speakers.map((speaker) => [speaker.id, speaker.label]))
  const chunks: SearchDocument[] = []
  let lines: string[] = []
  let from = 0
  let to = 0
  let length = 0

  const flush = (): void => {
    if (lines.length === 0) return
    chunks.push({
      source: 'transcript',
      text: lines.join('\n'),
      locator: { kind: 'segments', from, to }
    })
    lines = []
    length = 0
  }

  segments.forEach((segment, index) => {
    if (!segment.text.trim()) return
    const line = speakerLine(segment, labels)

    if (line.length > maxChars) {
      flush()
      for (const text of sliceByLength(line, maxChars)) {
        chunks.push({
          source: 'transcript',
          text,
          locator: { kind: 'segments', from: index, to: index + 1 }
        })
      }
      return
    }

    // 行の間の改行 1 字も数える。
    if (lines.length > 0 && length + 1 + line.length > maxChars) flush()

    if (lines.length === 0) from = index
    length += (lines.length === 0 ? 0 : 1) + line.length
    lines.push(line)
    to = index + 1
  })
  flush()

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
  source: Exclude<SearchSource, 'transcript' | 'title'>,
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
  readonly title: string
  readonly segments: readonly TranscriptSegment[]
  readonly speakers: readonly Speaker[]
  readonly summary: string | undefined
  readonly note: string
}

export const buildSearchDocuments = (material: SearchMaterial): SearchDocument[] => {
  const title = material.title.trim()

  return [
    ...(title ? [{ source: 'title' as const, text: title, locator: { kind: 'whole' as const } }] : []),
    ...chunkText('summary', material.summary ?? ''),
    ...chunkText('note', material.note),
    ...chunkTranscript(material.segments, material.speakers)
  ]
}
