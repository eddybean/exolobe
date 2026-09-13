import { describe, expect, it } from 'vitest'
import {
  buildSearchDocuments,
  chunkText,
  chunkTranscript,
  excerptFor,
  fingerprint,
  focusQuery,
  rankRecordings,
  searchIndexTransition,
  type SearchDocument,
  type SearchMaterial
} from '@domain/SemanticSearch'
import { dot, normalize } from '@domain/vector'
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
    const [first] = chunkTranscript(segments, speakers, 30)

    expect(first).toEqual({
      source: 'transcript',
      text: `自分: ${'あ'.repeat(10)}\n田中: ${'い'.repeat(10)}`,
      locator: { kind: 'segments', from: 0, to: 2 }
    })
  })

  it('窓を半分ずつ重ねてずらす（境目をまたぐ短い話題も、どれかの窓にまとまって入る）', () => {
    const segments = ['あ', 'い', 'う', 'え', 'お', 'か'].map((text, index) =>
      segment(index * 1_000, 'self', text.repeat(10))
    )

    // 1 行 14 字。30 字の窓には 2 行ずつ入り、1 行ずつずれる。
    const chunks = chunkTranscript(segments, speakers, 30)

    expect(chunks.map((chunk) => chunk.locator)).toEqual([
      { kind: 'segments', from: 0, to: 2 },
      { kind: 'segments', from: 1, to: 3 },
      { kind: 'segments', from: 2, to: 4 },
      { kind: 'segments', from: 3, to: 5 },
      { kind: 'segments', from: 4, to: 6 }
    ])
  })

  it('4 行入る窓は 2 行ずつずらす', () => {
    const segments = ['あ', 'い', 'う', 'え', 'お', 'か'].map((text, index) =>
      segment(index * 1_000, 'self', text.repeat(10))
    )

    // 4 行 = 14×4+3 = 59 字。
    const chunks = chunkTranscript(segments, speakers, 60)

    expect(chunks.map((chunk) => chunk.locator)).toEqual([
      { kind: 'segments', from: 0, to: 4 },
      { kind: 'segments', from: 2, to: 6 }
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
  it('要約・メモ・文字起こしの順に並べ、無いものは省く', () => {
    const documents = buildSearchDocuments({
      segments: [segment(0, 'self', '雨ですね')],
      speakers,
      summary: undefined,
      note: 'メモ'
    })

    expect(documents.map((document) => [document.source, document.text])).toEqual([
      ['note', 'メモ'],
      ['transcript', '自分: 雨ですね']
    ])
  })

})

describe('fingerprint', () => {
  const documents: SearchDocument[] = [
    { source: 'summary', text: '## 概要', locator: { kind: 'range', start: 0, end: 5 } },
    { source: 'transcript', text: '自分: 雨ですね', locator: { kind: 'segments', from: 0, to: 1 } }
  ]

  it('同じ入力からは同じ値を返す', () => {
    expect(fingerprint('bge-m3', documents)).toBe(fingerprint('bge-m3', [...documents]))
  })

  it('本文が変われば値が変わる（話者名の変更も含む）', () => {
    const renamed = documents.map((document) =>
      document.source === 'transcript' ? { ...document, text: '佐藤: 雨ですね' } : document
    )

    expect(fingerprint('bge-m3', renamed)).not.toBe(fingerprint('bge-m3', documents))
  })

  it('モデルが変われば値が変わる（別モデルのベクトルとは比較できない）', () => {
    expect(fingerprint('other-model', documents)).not.toBe(fingerprint('bge-m3', documents))
  })
})

describe('rankRecordings', () => {
  const chunk = (x: number, y: number): { vector: Float32Array; id: string } => ({
    vector: normalize([x, y]),
    id: `${x},${y}`
  })
  const query = normalize([1, 0])

  it('録音ごとに最もよく合うチャンクを代表にし、スコア順に並べる', () => {
    const hits = rankRecordings(
      query,
      [
        { recordingId: 'a', chunks: [chunk(1, 1), chunk(1, 0.1)] },
        { recordingId: 'b', chunks: [chunk(1, 0.3)] }
      ],
      { minScore: 0, margin: 1 }
    )

    expect(hits.map((hit) => [hit.recordingId, hit.chunk.id])).toEqual([
      ['a', '1,0.1'],
      ['b', '1,0.3']
    ])
    expect(hits[0]?.score).toBeCloseTo(dot(query, normalize([1, 0.1])))
  })

  it('最低スコアに届かない録音は返さない', () => {
    const hits = rankRecordings(query, [{ recordingId: 'a', chunks: [chunk(0, 1)] }], {
      minScore: 0.5,
      margin: 1
    })

    expect(hits).toEqual([])
  })

  it('首位から大きく離れた録音は返さない（語句の癖で底上げされた無関係な録音を落とす）', () => {
    const hits = rankRecordings(
      query,
      [
        { recordingId: 'near', chunks: [chunk(1, 0.1)] },
        { recordingId: 'far', chunks: [chunk(1, 1)] }
      ],
      { minScore: 0, margin: 0.1 }
    )

    expect(hits.map((hit) => hit.recordingId)).toEqual(['near'])
  })

  it('件数の上限で切る', () => {
    const entries = ['a', 'b', 'c'].map((recordingId) => ({
      recordingId,
      chunks: [chunk(1, 0)]
    }))

    expect(rankRecordings(query, entries, { limit: 2, minScore: 0, margin: 1 })).toHaveLength(2)
  })

  it('チャンクの無い録音は無視する', () => {
    expect(rankRecordings(query, [{ recordingId: 'a', chunks: [] }], { minScore: 0 })).toEqual([])
  })
})

describe('excerptFor', () => {
  const material: SearchMaterial = {
    segments: [
      segment(0, 'self', 'おはようございます'),
      segment(65_000, 'remote', '今日は雨がひどいですね'),
      segment(70_000, 'self', '傘が壊れました')
    ],
    speakers,
    summary: '## 概要\n- 天気の話をした\n\n## 決定事項\n- なし',
    note: ''
  }

  it('文字起こしは話者名付きで、該当区間の開始時刻を添える', () => {
    expect(excerptFor('transcript', { kind: 'segments', from: 1, to: 3 }, material)).toEqual({
      excerpt: '田中: 今日は雨がひどいですね 自分: 傘が壊れました',
      startMs: 65_000
    })
  })

  it('要約・メモは Markdown の記号を落として 1 行に詰める', () => {
    expect(excerptFor('summary', { kind: 'range', start: 0, end: 16 }, material)).toEqual({
      excerpt: '概要 天気の話をした'
    })
  })

  it('長い抜粋は末尾を省略する', () => {
    const long = { ...material, note: 'あ'.repeat(200) }

    const { excerpt } = excerptFor('note', { kind: 'range', start: 0, end: 200 }, long, 10)

    expect(excerpt).toBe(`${'あ'.repeat(10)}…`)
  })

  it('索引を作った後に内容が縮んでいても落ちない', () => {
    expect(excerptFor('transcript', { kind: 'segments', from: 5, to: 9 }, material)).toEqual({
      excerpt: ''
    })
  })
})

describe('searchIndexTransition', () => {
  const on = { enabled: true, modelPath: '/models/bge-m3.gguf' }
  const off = { enabled: false, modelPath: '/models/bge-m3.gguf' }

  it('無効にしたら索引を消す', () => {
    expect(searchIndexTransition(on, off)).toBe('clear')
  })

  it('有効にしたら同期する', () => {
    expect(searchIndexTransition(off, on)).toBe('sync')
  })

  it('有効なままモデルが変わったら、読み込み済みのモデルを捨てて作り直す', () => {
    expect(searchIndexTransition(on, { ...on, modelPath: '/models/other.gguf' })).toBe('rebuild')
  })

  it('それ以外は何もしない', () => {
    expect(searchIndexTransition(on, on)).toBe('none')
    expect(searchIndexTransition(off, { ...off, modelPath: '' })).toBe('none')
  })
})

describe('focusQuery', () => {
  it('依頼の言い回しと「〜をしたミーティング」を除き、話題だけを残す', () => {
    // 定型句が残ると、どの会議の文字起こしとも「会議らしさ」で近くなり、差が縮む。
    expect(focusQuery('天気の話をしたミーティングを教えて')).toBe('天気の話')
    expect(focusQuery('採用についての会議を探してください。')).toBe('採用')
    expect(focusQuery('予算の打ち合わせを見せて')).toBe('予算')
  })

  it('会議の名前の一部になっている語は残す', () => {
    expect(focusQuery('経営会議')).toBe('経営会議')
    expect(focusQuery('予算を削った会議')).toBe('予算を削った会議')
  })

  it('取り除くと何も残らないなら元のまま使う', () => {
    expect(focusQuery('会議を教えて')).toBe('会議')
    expect(focusQuery('教えて')).toBe('教えて')
  })

  it('前後の空白を落とす', () => {
    expect(focusQuery('  雨の話  ')).toBe('雨の話')
  })
})
