import { describe, expect, it } from 'vitest'
import { buildSearchDocuments, chunkText, chunkTranscript } from '@domain/SemanticSearch'
import type { Speaker } from '@domain/Speaker'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

const speakers: Speaker[] = [
  { id: 'self', kind: 'self', label: '自分' },
  { id: 'remote', kind: 'remote', label: '田中' }
]

const segment = (startMs: number, speakerId: string, text: string): TranscriptSegment => ({
  startMs,
  endMs: startMs + 1_000,
  speakerId,
  text
})

describe('chunkTranscript', () => {
  it('連続する発言を話者名付きで束ね、上限を超える前に区切る', () => {
    const segments = [
      segment(0, 'self', 'あ'.repeat(10)),
      segment(1_000, 'remote', 'い'.repeat(10)),
      segment(2_000, 'self', 'う'.repeat(10))
    ]

    // 「自分: 」+10 字 = 14 字。2 行（改行込み 29 字）までは 30 字に収まる。
    const chunks = chunkTranscript(segments, speakers, 30)

    expect(chunks).toEqual([
      {
        source: 'transcript',
        text: `自分: ${'あ'.repeat(10)}\n田中: ${'い'.repeat(10)}`,
        locator: { kind: 'segments', from: 0, to: 2 }
      },
      {
        source: 'transcript',
        text: `自分: ${'う'.repeat(10)}`,
        locator: { kind: 'segments', from: 2, to: 3 }
      }
    ])
  })

  it('話者一覧に無い ID はそのまま名前として使う', () => {
    const chunks = chunkTranscript([segment(0, 'remote:spk9', 'こんにちは')], speakers, 500)

    expect(chunks[0]?.text).toBe('remote:spk9: こんにちは')
  })

  it('1 発言だけで上限を超える場合は、同じ位置情報のまま文字で分割する', () => {
    const chunks = chunkTranscript([segment(0, 'self', 'あ'.repeat(20))], speakers, 10)

    // 「自分: 」+20 字 = 24 字を 10 字ずつ。
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      '自分: ああああああ',
      'ああああああああああ',
      'ああああ'
    ])
    expect(chunks.every((chunk) => chunk.locator.kind === 'segments')).toBe(true)
  })

  it('空白だけの発言は含めない', () => {
    expect(chunkTranscript([segment(0, 'self', '  ')], speakers, 500)).toEqual([])
  })
})

describe('chunkText', () => {
  it('空行で段落に分け、上限まで束ねて元の文字範囲を持たせる', () => {
    const markdown = '## 概要\n天気の話\n\n## 決定事項\n予算削減'

    const chunks = chunkText('summary', markdown, 12)

    expect(chunks).toEqual([
      { source: 'summary', text: '## 概要\n天気の話', locator: { kind: 'range', start: 0, end: 10 } },
      {
        source: 'summary',
        text: '## 決定事項\n予算削減',
        locator: { kind: 'range', start: 12, end: 24 }
      }
    ])
  })

  it('上限を超える段落は文字数で分割する', () => {
    const chunks = chunkText('note', 'あ'.repeat(25), 10)

    expect(chunks.map((chunk) => chunk.locator)).toEqual([
      { kind: 'range', start: 0, end: 10 },
      { kind: 'range', start: 10, end: 20 },
      { kind: 'range', start: 20, end: 25 }
    ])
  })

  it('空のテキストからはチャンクを作らない', () => {
    expect(chunkText('note', '\n\n  \n', 500)).toEqual([])
  })
})

describe('buildSearchDocuments', () => {
  it('タイトル・要約・メモ・文字起こしの順に並べ、無いものは省く', () => {
    const documents = buildSearchDocuments({
      title: '定例',
      segments: [segment(0, 'self', '雨ですね')],
      speakers,
      summary: undefined,
      note: 'メモ'
    })

    expect(documents.map((document) => [document.source, document.text])).toEqual([
      ['title', '定例'],
      ['note', 'メモ'],
      ['transcript', '自分: 雨ですね']
    ])
  })
})
