import { describe, expect, it } from 'vitest'
import {
  CHAT_RESERVED_RATIO,
  MIN_PER_RECORDING_CHARS,
  buildChatContext,
  contextBudgetChars,
  filterSegmentsByScope,
  type ChatSourceMaterial
} from '@domain/ChatContext'
import type { Speaker } from '@domain/Speaker'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

const speakers: Speaker[] = [
  { id: 'self', kind: 'self', label: '自分' },
  { id: 'remote:spk0', kind: 'remote', label: '田中' },
  { id: 'remote:spk1', kind: 'remote', label: '佐藤' }
]

const segment = (startMs: number, speakerId: string, text: string): TranscriptSegment => ({
  startMs,
  endMs: startMs + 1_000,
  speakerId,
  text
})

const segments: TranscriptSegment[] = [
  segment(0, 'self', 'おはようございます'),
  segment(2_000, 'remote:spk0', '見積もりの件です'),
  segment(4_000, 'remote:spk1', '私も確認しました'),
  segment(6_000, 'self', '来週までに出します')
]

const material = (
  overrides: Partial<ChatSourceMaterial> & Pick<ChatSourceMaterial, 'recordingId'>
): ChatSourceMaterial => ({
  title: '週次定例',
  startedAt: new Date('2026-09-08T14:30:00+09:00'),
  segments,
  speakers,
  ...overrides
})

describe('filterSegmentsByScope', () => {
  it('self は自分のセグメントだけを残す', () => {
    const result = filterSegmentsByScope(segments, speakers, 'self')

    expect(result.map((s) => s.text)).toEqual(['おはようございます', '来週までに出します'])
  })

  it('remote はクラスタ付きの話者も残す', () => {
    const result = filterSegmentsByScope(segments, speakers, 'remote')

    expect(result.map((s) => s.text)).toEqual(['見積もりの件です', '私も確認しました'])
  })

  it('all は全部残す', () => {
    expect(filterSegmentsByScope(segments, speakers, 'all')).toHaveLength(4)
  })
})

describe('contextBudgetChars', () => {
  it('出力のぶんを残した文字数を返す', () => {
    expect(contextBudgetChars(32_768)).toBe(Math.floor(32_768 * (1 - CHAT_RESERVED_RATIO) * 1.5))
  })
})

describe('buildChatContext — 素材の選び方', () => {
  it('既定では要約を使い、引用にもそう記録する', () => {
    const context = buildChatContext({
      materials: [material({ recordingId: 'rec-1', summary: '## 決定事項\n- 見積もりは来週' })],
      scope: 'all',
      useTranscript: false,
      budgetChars: 10_000
    })

    expect(context.text).toContain('見積もりは来週')
    expect(context.text).not.toContain('おはようございます')
    expect(context.citations[0]?.source).toBe('summary')
  })

  it('要約が無い録音は文字起こしにフォールバックする', () => {
    const context = buildChatContext({
      materials: [material({ recordingId: 'rec-1' })],
      scope: 'all',
      useTranscript: false,
      budgetChars: 10_000
    })

    expect(context.text).toContain('おはようございます')
    expect(context.citations[0]?.source).toBe('transcript')
  })

  it('話者を絞るときは要約があっても文字起こしを使う', () => {
    const context = buildChatContext({
      materials: [material({ recordingId: 'rec-1', summary: '## 決定事項\n- 見積もりは来週' })],
      scope: 'self',
      useTranscript: true,
      budgetChars: 10_000
    })

    expect(context.text).toContain('来週までに出します')
    expect(context.text).not.toContain('見積もりの件です')
    expect(context.text).toContain('自分の発言のみ')
  })

  it('見出しに番号・日付・曜日・タイトルを入れる', () => {
    const context = buildChatContext({
      materials: [material({ recordingId: 'rec-1', summary: '要約' })],
      scope: 'all',
      useTranscript: false,
      budgetChars: 10_000
    })

    expect(context.text).toContain('## [1] 2026-09-08（火） 週次定例')
  })
})

describe('buildChatContext — 予算', () => {
  const long = (chars: number): string => 'あ'.repeat(chars)

  it('長い 1 件が予算を食い尽くさず、他の録音も載る', () => {
    const context = buildChatContext({
      materials: [
        material({ recordingId: 'rec-long', title: '長い会議', summary: long(5_000) }),
        material({ recordingId: 'rec-short', title: '短い会議', summary: '短い要約です' })
      ],
      scope: 'all',
      useTranscript: false,
      budgetChars: 2_000
    })

    expect(context.text).toContain('長い会議')
    expect(context.text).toContain('短い会議')
    expect(context.text).toContain('短い要約です')
    expect(context.droppedCount).toBe(0)
  })

  it('切り詰めた録音には省略の印を付ける', () => {
    const context = buildChatContext({
      materials: [material({ recordingId: 'rec-1', summary: long(5_000) })],
      scope: 'all',
      useTranscript: false,
      budgetChars: 2_000
    })

    expect(context.text).toContain('（以下省略）')
    expect(context.citations[0]?.truncated).toBe(true)
    expect(context.text.length).toBeLessThanOrEqual(2_000 + 500)
  })

  it('1 件あたりの割り当てが足りなくなる録音は載せず droppedCount に数える', () => {
    const materials = Array.from({ length: 10 }, (_unused, index) =>
      material({ recordingId: `rec-${index}`, title: `会議${index}`, summary: long(1_000) })
    )

    const context = buildChatContext({
      materials,
      scope: 'all',
      useTranscript: false,
      budgetChars: MIN_PER_RECORDING_CHARS * 3
    })

    expect(context.citations.length).toBeLessThanOrEqual(3)
    expect(context.droppedCount).toBe(materials.length - context.citations.length)
    expect(context.text).toContain('載せています')
  })

  it('落とすのは古い方から。新しい録音を先に載せる', () => {
    const older = material({
      recordingId: 'old',
      title: '古い会議',
      startedAt: new Date('2026-09-01T10:00:00+09:00'),
      summary: long(1_000)
    })
    const newer = material({
      recordingId: 'new',
      title: '新しい会議',
      startedAt: new Date('2026-09-10T10:00:00+09:00'),
      summary: long(1_000)
    })

    const context = buildChatContext({
      materials: [newer, older],
      scope: 'all',
      useTranscript: false,
      budgetChars: MIN_PER_RECORDING_CHARS
    })

    expect(context.citations.map((c) => c.recordingId)).toEqual(['new'])
    expect(context.droppedCount).toBe(1)
  })

  it('素材が無ければ空の文脈を返す', () => {
    const context = buildChatContext({
      materials: [],
      scope: 'all',
      useTranscript: false,
      budgetChars: 10_000
    })

    expect(context.citations).toHaveLength(0)
    expect(context.droppedCount).toBe(0)
  })
})

describe('buildChatContext — 引用', () => {
  it('文字起こしの引用には先頭セグメントの開始時刻を入れる', () => {
    const context = buildChatContext({
      materials: [material({ recordingId: 'rec-1' })],
      scope: 'self',
      useTranscript: true,
      budgetChars: 10_000
    })

    expect(context.citations[0]?.startMs).toBe(0)
  })

  it('要約の引用には時刻を入れない', () => {
    const context = buildChatContext({
      materials: [material({ recordingId: 'rec-1', summary: '要約' })],
      scope: 'all',
      useTranscript: false,
      budgetChars: 10_000
    })

    expect(context.citations[0]?.startMs).toBeUndefined()
  })
})

describe('buildChatContext — 要約の節で絞る', () => {
  const summary = [
    '## 概要',
    '週次の定例。',
    '',
    '## 決定事項',
    '- 面接官は自分が担当',
    '',
    '## ToDo（担当者と期限が分かる場合は併記）',
    '- 求人票を来週までに更新する',
    '',
    '## 議論の流れ',
    '- 採用の進み具合を確認した'
  ].join('\n')

  const withSummary = material({ recordingId: 'rec-1', summary })

  const build = (section?: 'todo' | 'decision' | 'overview' | 'discussion') =>
    buildChatContext({
      materials: [withSummary],
      scope: 'all',
      useTranscript: false,
      budgetChars: 10_000,
      ...(section === undefined ? {} : { section })
    })

  it('ToDo を名指しされたら ToDo の節だけを載せる', () => {
    const context = build('todo')

    expect(context.text).toContain('求人票を来週までに更新する')
    expect(context.text).not.toContain('面接官は自分が担当')
    expect(context.text).not.toContain('採用の進み具合')
  })

  it('決定事項を名指しされたら決定事項の節だけを載せる', () => {
    const context = build('decision')

    expect(context.text).toContain('面接官は自分が担当')
    expect(context.text).not.toContain('求人票を来週まで')
  })

  it('節の見出しは残す。何の一覧かをモデルが取り違えないように', () => {
    expect(build('todo').text).toContain('## ToDo')
  })

  it('名指しが無ければ要約の全体を載せる', () => {
    const context = build()

    expect(context.text).toContain('面接官は自分が担当')
    expect(context.text).toContain('求人票を来週までに更新する')
  })

  it('その節が要約に無ければ全体を載せる', () => {
    const context = buildChatContext({
      materials: [material({ recordingId: 'rec-1', summary: '## 概要\n雑談だけだった。' })],
      scope: 'all',
      useTranscript: false,
      budgetChars: 10_000,
      section: 'todo'
    })

    expect(context.text).toContain('雑談だけだった')
  })

  it('文字起こしを使うときは節で絞らない', () => {
    const context = buildChatContext({
      materials: [material({ recordingId: 'rec-1', summary })],
      scope: 'self',
      useTranscript: true,
      budgetChars: 10_000,
      section: 'todo'
    })

    expect(context.text).toContain('おはようございます')
  })
})
