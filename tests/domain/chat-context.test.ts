import { describe, expect, it } from 'vitest'
import {
  ANSWER_TOKENS,
  CHARS_PER_TOKEN,
  INSTRUCTION_TOKENS,
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
  it('回答と指示文のぶんを引いた残りを文字数に直す', () => {
    const tokens = 32_768 - ANSWER_TOKENS - INSTRUCTION_TOKENS

    expect(contextBudgetChars(32_768)).toBe(Math.floor(tokens * CHARS_PER_TOKEN))
  })

  it('1 文字が 1 トークンに収まる前提にしない', () => {
    // 日本語は 1 文字で 1 トークン以上かかる。文字数の予算が
    // トークン数を上回ると、モデルのコンテキストを静かに溢れさせる。
    expect(CHARS_PER_TOKEN).toBeLessThanOrEqual(1)
  })

  it('予算が 32K のコンテキストを超えない', () => {
    const budget = contextBudgetChars(32_768)
    // 最悪でも 1 文字 = 1/CHARS_PER_TOKEN トークンとして見積もる。
    const worstCase = budget / CHARS_PER_TOKEN + ANSWER_TOKENS + INSTRUCTION_TOKENS

    expect(worstCase).toBeLessThanOrEqual(32_768)
  })

  it('会話履歴のぶんだけ予算が減る', () => {
    const without = contextBudgetChars(32_768)
    const with3000 = contextBudgetChars(32_768, { historyChars: 3_000 })

    expect(with3000).toBeLessThan(without)
    // 履歴 3000 字は 3000/CHARS_PER_TOKEN トークンぶんの席を取る。
    expect(without - with3000).toBe(
      Math.floor(without) - Math.floor((32_768 - ANSWER_TOKENS - INSTRUCTION_TOKENS -
        Math.ceil(3_000 / CHARS_PER_TOKEN)) * CHARS_PER_TOKEN)
    )
  })

  it('履歴が長すぎても負の予算にはしない', () => {
    expect(contextBudgetChars(4_096, { historyChars: 100_000 })).toBe(0)
  })
})

describe('buildChatContext — 素材の選び方', () => {
  it('既定では要約を使い、引用にもそう記録する', () => {
    const context = buildChatContext({
      language: 'ja',
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
      language: 'ja',
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
      language: 'ja',
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
      language: 'ja',
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
      language: 'ja',
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
      language: 'ja',
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
      language: 'ja',
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
      language: 'ja',
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
      language: 'ja',
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
      language: 'ja',
      materials: [material({ recordingId: 'rec-1' })],
      scope: 'self',
      useTranscript: true,
      budgetChars: 10_000
    })

    expect(context.citations[0]?.startMs).toBe(0)
  })

  it('要約の引用には時刻を入れない', () => {
    const context = buildChatContext({
      language: 'ja',
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
      language: 'ja',
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
      language: 'ja',
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
      language: 'ja',
      materials: [material({ recordingId: 'rec-1', summary })],
      scope: 'self',
      useTranscript: true,
      budgetChars: 10_000,
      section: 'todo'
    })

    expect(context.text).toContain('おはようございます')
  })
})

describe('buildChatContext — 予算が尽きている場合', () => {
  it('予算が 0 なら何も載せず、全件を落としたと数える', () => {
    // 中身の無い見出しだけを渡すと、モデルは「その会議には何も無かった」と読む。
    const context = buildChatContext({
      language: 'ja',
      materials: [
        material({ recordingId: 'rec-1', summary: '## 決定事項\n- 合意した' }),
        material({ recordingId: 'rec-2', summary: '## 決定事項\n- 決めた' })
      ],
      scope: 'all',
      useTranscript: false,
      budgetChars: 0
    })

    expect(context.citations).toHaveLength(0)
    expect(context.droppedCount).toBe(2)
    expect(context.text).not.toContain('合意した')
  })
})

/** 英語の問いには、文脈の見出しと注記も英語で渡す（指示文と文脈の言語を揃える）。 */
describe('buildChatContext — 英語の問い', () => {
  it('曜日と素材の注記を英語にする', () => {
    const context = buildChatContext({
      language: 'en',
      materials: [material({ recordingId: 'rec-1', summary: '## Decisions\n- Ship next week' })],
      scope: 'all',
      useTranscript: false,
      budgetChars: 10_000
    })

    expect(context.text).toMatch(/^## \[1\] \d{4}-\d{2}-\d{2} \((Sun|Mon|Tue|Wed|Thu|Fri|Sat)\) /)
    expect(context.text).toContain('(summary)')
    expect(context.text).not.toContain('（要約）')
  })

  it('話者で絞った文字起こしは、誰の発言に絞ったかを英語で添える', () => {
    const context = buildChatContext({
      language: 'en',
      materials: [material({ recordingId: 'rec-1' })],
      scope: 'self',
      useTranscript: true,
      budgetChars: 10_000
    })

    expect(context.text).toContain('(your remarks only, transcript)')
  })

  it('英語の見出しの要約からも名指しの節を取り出す', () => {
    const summary = '## Overview\nWeekly sync\n## To-dos\n- [ ] Send the estimate\n## Discussion\nPricing'
    const context = buildChatContext({
      language: 'en',
      materials: [material({ recordingId: 'rec-1', summary })],
      scope: 'all',
      useTranscript: false,
      budgetChars: 10_000,
      section: 'todo'
    })

    expect(context.text).toContain('Send the estimate')
    expect(context.text).not.toContain('Pricing')
  })
})
