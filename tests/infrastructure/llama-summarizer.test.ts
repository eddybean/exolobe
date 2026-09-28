import { describe, expect, it } from 'vitest'
import {
  hallucinationGuard,
  LlamaCppSummarizer,
  renderPrompt,
  splitTranscript,
  type LlmSession,
  type LlmSessionFactory
} from '@infrastructure/summarization/LlamaCppSummarizer'
import {
  DEFAULT_SUMMARY_PROMPT,
  DEFAULT_SUMMARY_PROMPT_EN,
  NOTES_PLACEHOLDER,
  TRANSCRIPT_PLACEHOLDER
} from '@domain/Settings'

describe('splitTranscript', () => {
  it('収まるならそのまま 1 件で返す', () => {
    expect(splitTranscript('短い文字起こし', 1000)).toEqual(['短い文字起こし'])
  })

  it('発話ブロックの境界で分割する', () => {
    const transcript = ['**[00:00] 自分**\nあいうえお', '**[00:05] 相手**\nかきくけこ'].join('\n\n')

    const chunks = splitTranscript(transcript, 20)

    expect(chunks).toEqual(['**[00:00] 自分**\nあいうえお', '**[00:05] 相手**\nかきくけこ'])
  })

  it('1 ブロックが上限を超えても発話の途中では切らない', () => {
    const long = `**[00:00] 自分**\n${'あ'.repeat(100)}`

    expect(splitTranscript(long, 20)).toEqual([long])
  })

  it('収まる範囲では複数ブロックをまとめる', () => {
    const transcript = ['A', 'B', 'C'].map((t) => `**[00:00] 自分**\n${t}`).join('\n\n')

    const chunks = splitTranscript(transcript, 40)

    expect(chunks).toHaveLength(2)
    expect(chunks.join('\n\n')).toBe(transcript)
  })
})

describe('renderPrompt', () => {
  it('差し込み位置に文字起こしを入れる', () => {
    expect(renderPrompt(`前${TRANSCRIPT_PLACEHOLDER}後`, '本文')).toBe('前本文後')
  })

  it('差し込み位置が無ければ末尾に付ける', () => {
    expect(renderPrompt('要約して', '本文')).toBe('要約して\n\n本文')
  })

  it('メモの差し込み位置にメモを入れる', () => {
    expect(
      renderPrompt(`前${NOTES_PLACEHOLDER}中${TRANSCRIPT_PLACEHOLDER}後`, '本文', 'メモ')
    ).toBe('前メモ中本文後')
  })

  it('メモの差し込み位置が無ければ末尾に付ける（{{notes}} を足す前に保存したプロンプト）', () => {
    expect(renderPrompt(`要約して${TRANSCRIPT_PLACEHOLDER}`, '本文', 'メモ')).toBe(
      '要約して本文\n\nメモ'
    )
  })

  it('メモが無ければ差し込み位置は消し、末尾にも何も付けない', () => {
    expect(renderPrompt(`前${NOTES_PLACEHOLDER}${TRANSCRIPT_PLACEHOLDER}`, '本文', '')).toBe('前本文')
    expect(renderPrompt(`前${TRANSCRIPT_PLACEHOLDER}`, '本文', '')).toBe('前本文')
  })
})

describe('hallucinationGuard', () => {
  it('反復と字幕の定型句を無視させる指示を含む', () => {
    expect(hallucinationGuard('ja')).toContain('繰り返')
    expect(hallucinationGuard('ja')).toContain('字幕')
  })

  it('利用者が編集できるプロンプトの既定値には入れない', () => {
    // 設定画面で消せてしまうと、防御の有無が利用者ごとに変わる。
    expect(DEFAULT_SUMMARY_PROMPT).not.toContain(hallucinationGuard('ja'))
  })
})

class FakeLlm implements LlmSession {
  prompts: string[] = []
  disposed = 0
  responder: (prompt: string) => string = () => '## 概要\n要約結果'

  async prompt(text: string): Promise<string> {
    this.prompts.push(text)
    return this.responder(text)
  }
  async dispose(): Promise<void> {
    this.disposed += 1
  }
}

const factoryFor = (session: LlmSession): LlmSessionFactory => ({
  create: async () => session
})

describe('LlamaCppSummarizer', () => {
  const config = {
    modelPath: '/models/qwen3-8b.gguf',
    contextSize: 8_192,
    protection: 'standard' as const
  }

  it('コンテキストに収まる文字起こしは 1 回のプロンプトで要約する', async () => {
    const llm = new FakeLlm()
    const summarizer = new LlamaCppSummarizer(config, factoryFor(llm))

    const summary = await summarizer.summarize({
      language: 'ja',
      transcript: '**[00:00] 自分**\nおはようございます',
      promptTemplate: DEFAULT_SUMMARY_PROMPT
    })

    expect(llm.prompts).toHaveLength(1)
    expect(llm.prompts[0]).toContain('おはようございます')
    expect(summary).toBe('## 概要\n要約結果')
  })

  it('利用者のプロンプトに関わらず防御の指示を前置きする', async () => {
    const llm = new FakeLlm()
    const summarizer = new LlamaCppSummarizer(config, factoryFor(llm))

    await summarizer.summarize({
      language: 'ja',
      transcript: '**[00:00] 自分**\nおはようございます',
      promptTemplate: `独自のプロンプト${TRANSCRIPT_PLACEHOLDER}`
    })

    expect(llm.prompts[0]).toContain(hallucinationGuard('ja'))
    expect(llm.prompts[0]).toContain('独自のプロンプト')
  })

  it('部分要約にも防御の指示を前置きする', async () => {
    // 分割したときは部分要約がハルシネーションを拾い、統合へ持ち込んでしまう。
    const llm = new FakeLlm()
    const summarizer = new LlamaCppSummarizer({ ...config, contextSize: 1_024 }, factoryFor(llm))
    const transcript = Array.from(
      { length: 30 },
      (_, i) => `**[00:0${i % 10}] 自分**\n${'あ'.repeat(60)}`
    ).join('\n\n')

    await summarizer.summarize({
      language: 'ja',
      transcript,
      promptTemplate: DEFAULT_SUMMARY_PROMPT
    })

    expect(llm.prompts.every((p) => p.includes(hallucinationGuard('ja')))).toBe(true)
  })

  it('長い文字起こしは部分要約してから統合する', async () => {
    const llm = new FakeLlm()
    // 最終プロンプトだけが持つ見出し指定で、部分要約と統合を見分ける
    llm.responder = (prompt) =>
      prompt.includes('## 決定事項') ? '## 概要\n最終要約' : '・部分要約'

    // contextSize を絞って必ず分割させる
    const summarizer = new LlamaCppSummarizer(
      { ...config, contextSize: 1_024 },
      factoryFor(llm)
    )
    const transcript = Array.from(
      { length: 30 },
      (_, i) => `**[00:0${i % 10}] 自分**\n${'あ'.repeat(60)}`
    ).join('\n\n')

    const summary = await summarizer.summarize({
      language: 'ja',
      transcript,
      promptTemplate: DEFAULT_SUMMARY_PROMPT
    })

    // 部分要約が複数回 + 最終統合が 1 回
    expect(llm.prompts.length).toBeGreaterThan(2)
    expect(llm.prompts.at(-1)).toContain('・部分要約')
    expect(summary).toBe('## 概要\n最終要約')
  })

  it('部分要約を束ねてもコンテキストに収まらなければ、もう一段まとめてから統合する', async () => {
    // Apple Intelligence（8192 トークン）では、2 時間を超える会議で部分要約の合計が統合の段に収まらない。
    const long = 'い'.repeat(400)
    const llm = new FakeLlm()
    llm.responder = (prompt) => {
      if (prompt.includes('## 決定事項')) return '## 概要\n最終要約'
      if (prompt.includes(long)) return '・二段目'
      return `・${long}`
    }
    const summarizer = new LlamaCppSummarizer({ ...config, contextSize: 1_024 }, factoryFor(llm))
    const transcript = Array.from(
      { length: 30 },
      (_, i) => `**[00:0${i % 10}] 自分**\n${'あ'.repeat(60)}`
    ).join('\n\n')

    const summary = await summarizer.summarize({
      language: 'ja',
      transcript,
      promptTemplate: DEFAULT_SUMMARY_PROMPT
    })

    const final = llm.prompts.at(-1) ?? ''
    expect(final).toContain('・二段目')
    expect(final).not.toContain(long)
    expect(summary).toBe('## 概要\n最終要約')
  })

  it('まとめ直しても縮まらない部分要約は、打ち切って統合へ進む', async () => {
    // 部分要約 1 件がそれだけで上限を超えると、何度分けても縮まらない。無限に回さない。
    const llm = new FakeLlm()
    llm.responder = (prompt) =>
      prompt.includes('## 決定事項') ? '## 概要\n最終要約' : `・${'う'.repeat(2_000)}`
    const summarizer = new LlamaCppSummarizer({ ...config, contextSize: 1_024 }, factoryFor(llm))
    const transcript = Array.from(
      { length: 30 },
      (_, i) => `**[00:0${i % 10}] 自分**\n${'あ'.repeat(60)}`
    ).join('\n\n')

    const summary = await summarizer.summarize({
      language: 'ja',
      transcript,
      promptTemplate: DEFAULT_SUMMARY_PROMPT
    })

    expect(summary).toBe('## 概要\n最終要約')
    expect(llm.prompts.length).toBeLessThan(30)
  })

  it('メモは最後の統合にだけ渡し、部分要約には渡さない', async () => {
    const llm = new FakeLlm()
    llm.responder = (prompt) =>
      prompt.includes('## 決定事項') ? '## 概要\n最終要約' : '・部分要約'
    const summarizer = new LlamaCppSummarizer(
      { ...config, contextSize: 1_024 },
      factoryFor(llm)
    )
    const transcript = Array.from(
      { length: 30 },
      (_, i) => `**[00:0${i % 10}] 自分**\n${'あ'.repeat(60)}`
    ).join('\n\n')

    await summarizer.summarize({
      language: 'ja',
      transcript,
      notes: '## 会議中のメモ\n価格改定',
      promptTemplate: DEFAULT_SUMMARY_PROMPT
    })

    expect(llm.prompts.at(-1)).toContain('価格改定')
    expect(llm.prompts.slice(0, -1).some((p) => p.includes('価格改定'))).toBe(false)
  })

  /** 英語の会議に日本語の指示を混ぜると、要約の一部が日本語で返る（ADR-043）。 */
  it('英語の会議には、防御の指示も部分要約の指示も英語で渡す', async () => {
    const llm = new FakeLlm()
    // contextSize を絞って必ず分割させる
    const summarizer = new LlamaCppSummarizer({ ...config, contextSize: 1_024 }, factoryFor(llm))
    const transcript = Array.from(
      { length: 30 },
      (_, i) => `**[00:0${i % 10}] Me**\n${'Discussing the estimate. '.repeat(10)}`
    ).join('\n\n')

    await summarizer.summarize({
      language: 'en',
      transcript,
      promptTemplate: DEFAULT_SUMMARY_PROMPT_EN
    })

    expect(llm.prompts.length).toBeGreaterThan(2)
    expect(llm.prompts.every((p) => p.includes(hallucinationGuard('en')))).toBe(true)
    expect(llm.prompts.some((p) => p.includes('bullet points'))).toBe(true)
    expect(llm.prompts.some((p) => /[\u3040-\u30ff]/.test(p))).toBe(false)
  })

  it('要約が終わったら必ずモデルを解放する', async () => {
    const llm = new FakeLlm()
    const summarizer = new LlamaCppSummarizer(config, factoryFor(llm))

    await summarizer.summarize({ language: 'ja', transcript: '本文', promptTemplate: DEFAULT_SUMMARY_PROMPT })

    expect(llm.disposed).toBe(1)
  })

  it('生成が失敗してもモデルを解放する', async () => {
    const llm = new FakeLlm()
    llm.responder = () => {
      throw new Error('生成に失敗しました')
    }
    const summarizer = new LlamaCppSummarizer(config, factoryFor(llm))

    await expect(
      summarizer.summarize({ language: 'ja', transcript: '本文', promptTemplate: DEFAULT_SUMMARY_PROMPT })
    ).rejects.toThrow('生成に失敗しました')
    expect(llm.disposed).toBe(1)
  })

  it('モデル未設定なら設定画面へ誘導する', async () => {
    const summarizer = new LlamaCppSummarizer(
      { ...config, modelPath: '' },
      factoryFor(new FakeLlm())
    )

    await expect(
      summarizer.summarize({ language: 'ja', transcript: '本文', promptTemplate: DEFAULT_SUMMARY_PROMPT })
    ).rejects.toThrow('summaryModelNotConfigured')
  })

  it('文字起こしが空なら要約せず失敗する', async () => {
    const llm = new FakeLlm()
    const summarizer = new LlamaCppSummarizer(config, factoryFor(llm))

    await expect(
      summarizer.summarize({ language: 'ja', transcript: '   \n  ', promptTemplate: DEFAULT_SUMMARY_PROMPT })
    ).rejects.toThrow('summaryTranscriptEmpty')
    expect(llm.prompts).toEqual([])
  })

  it('前後の空白を落とした要約を返す', async () => {
    const llm = new FakeLlm()
    llm.responder = () => '\n\n## 概要\n本文\n\n'
    const summarizer = new LlamaCppSummarizer(config, factoryFor(llm))

    expect(
      await summarizer.summarize({ language: 'ja', transcript: '本文', promptTemplate: DEFAULT_SUMMARY_PROMPT })
    ).toBe('## 概要\n本文')
  })
})
