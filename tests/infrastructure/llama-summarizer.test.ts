import { describe, expect, it } from 'vitest'
import {
  HALLUCINATION_GUARD,
  LlamaCppSummarizer,
  renderPrompt,
  splitTranscript,
  type LlmSession,
  type LlmSessionFactory
} from '@infrastructure/summarization/LlamaCppSummarizer'
import { DEFAULT_SUMMARY_PROMPT, TRANSCRIPT_PLACEHOLDER } from '@domain/Settings'

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
})

describe('HALLUCINATION_GUARD', () => {
  it('反復と字幕の定型句を無視させる指示を含む', () => {
    expect(HALLUCINATION_GUARD).toContain('繰り返')
    expect(HALLUCINATION_GUARD).toContain('字幕')
  })

  it('利用者が編集できるプロンプトの既定値には入れない', () => {
    // 設定画面で消せてしまうと、防御の有無が利用者ごとに変わる。
    expect(DEFAULT_SUMMARY_PROMPT).not.toContain(HALLUCINATION_GUARD)
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
      transcript: '**[00:00] 自分**\nおはようございます',
      promptTemplate: `独自のプロンプト${TRANSCRIPT_PLACEHOLDER}`
    })

    expect(llm.prompts[0]).toContain(HALLUCINATION_GUARD)
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

    await summarizer.summarize({ transcript, promptTemplate: DEFAULT_SUMMARY_PROMPT })

    expect(llm.prompts.every((p) => p.includes(HALLUCINATION_GUARD))).toBe(true)
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
      transcript,
      promptTemplate: DEFAULT_SUMMARY_PROMPT
    })

    // 部分要約が複数回 + 最終統合が 1 回
    expect(llm.prompts.length).toBeGreaterThan(2)
    expect(llm.prompts.at(-1)).toContain('・部分要約')
    expect(summary).toBe('## 概要\n最終要約')
  })

  it('要約が終わったら必ずモデルを解放する', async () => {
    const llm = new FakeLlm()
    const summarizer = new LlamaCppSummarizer(config, factoryFor(llm))

    await summarizer.summarize({ transcript: '本文', promptTemplate: DEFAULT_SUMMARY_PROMPT })

    expect(llm.disposed).toBe(1)
  })

  it('生成が失敗してもモデルを解放する', async () => {
    const llm = new FakeLlm()
    llm.responder = () => {
      throw new Error('生成に失敗しました')
    }
    const summarizer = new LlamaCppSummarizer(config, factoryFor(llm))

    await expect(
      summarizer.summarize({ transcript: '本文', promptTemplate: DEFAULT_SUMMARY_PROMPT })
    ).rejects.toThrow('生成に失敗しました')
    expect(llm.disposed).toBe(1)
  })

  it('モデル未設定なら設定画面へ誘導する', async () => {
    const summarizer = new LlamaCppSummarizer(
      { ...config, modelPath: '' },
      factoryFor(new FakeLlm())
    )

    await expect(
      summarizer.summarize({ transcript: '本文', promptTemplate: DEFAULT_SUMMARY_PROMPT })
    ).rejects.toThrow('要約モデルが設定されていません。設定画面でモデルを選んでください。')
  })

  it('文字起こしが空なら要約せず失敗する', async () => {
    const llm = new FakeLlm()
    const summarizer = new LlamaCppSummarizer(config, factoryFor(llm))

    await expect(
      summarizer.summarize({ transcript: '   \n  ', promptTemplate: DEFAULT_SUMMARY_PROMPT })
    ).rejects.toThrow('文字起こしが空のため要約できません。')
    expect(llm.prompts).toEqual([])
  })

  it('前後の空白を落とした要約を返す', async () => {
    const llm = new FakeLlm()
    llm.responder = () => '\n\n## 概要\n本文\n\n'
    const summarizer = new LlamaCppSummarizer(config, factoryFor(llm))

    expect(
      await summarizer.summarize({ transcript: '本文', promptTemplate: DEFAULT_SUMMARY_PROMPT })
    ).toBe('## 概要\n本文')
  })
})
