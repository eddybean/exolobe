import { describe, expect, it } from 'vitest'
import type { ChatTurn } from '@application/ports'
import {
  ChatError,
  LlamaCppChat,
  type ChatLlmSession,
  type ChatLlmSessionFactory
} from '@infrastructure/chat/LlamaCppChat'

interface Recorded {
  readonly system: string
  readonly turns: readonly ChatTurn[]
}

class FakeSession implements ChatLlmSession {
  histories: Recorded[] = []
  prompts: string[] = []
  disposed = 0
  chunks = ['答え', 'です']

  setHistory(system: string, turns: readonly ChatTurn[]): void {
    this.histories.push({ system, turns: [...turns] })
  }
  async prompt(
    text: string,
    options: { onChunk: (t: string) => void; signal?: AbortSignal }
  ): Promise<{ text: string; truncated: boolean }> {
    this.prompts.push(text)
    for (const chunk of this.chunks) options.onChunk(chunk)
    return { text: this.chunks.join(''), truncated: false }
  }
  async dispose(): Promise<void> {
    this.disposed += 1
  }
}

class FakeFactory implements ChatLlmSessionFactory {
  created = 0
  session = new FakeSession()
  configs: { modelPath: string; contextSize: number }[] = []

  async create(config: {
    modelPath: string
    contextSize: number
    protection: 'conservative' | 'standard' | 'off'
  }): Promise<ChatLlmSession> {
    this.created += 1
    this.configs.push({ modelPath: config.modelPath, contextSize: config.contextSize })
    return this.session
  }
}

const build = (modelPath = '/models/gemma.gguf') => {
  const factory = new FakeFactory()
  const chat = new LlamaCppChat({ modelPath, contextSize: 32_768, protection: 'standard' }, factory)
  return { chat, factory, session: factory.session }
}

const complete = async (
  chat: LlamaCppChat,
  overrides: Partial<{ history: readonly ChatTurn[]; prompt: string }> = {}
) => {
  const received: string[] = []
  const completion = await chat.complete({
    system: 'あなたはアシスタントです。',
    history: overrides.history ?? [],
    prompt: overrides.prompt ?? '質問です',
    onChunk: (chunk) => received.push(chunk)
  })
  return { text: completion.text, received }
}

describe('LlamaCppChat', () => {
  it('断片を onChunk へ素通しし、連結を返す', async () => {
    const { chat, session } = build()

    const { text, received } = await complete(chat)

    expect(received).toEqual(session.chunks)
    expect(text).toBe('答えです')
  })

  it('毎ターン system と履歴を丸ごと入れ替えてから尋ねる', async () => {
    const { chat, session } = build()
    const history: ChatTurn[] = [
      { role: 'user', text: '先週のTODOは？' },
      { role: 'assistant', text: '見積もりです。' }
    ]

    await complete(chat, { history })

    expect(session.histories).toHaveLength(1)
    expect(session.histories[0]?.system).toBe('あなたはアシスタントです。')
    expect(session.histories[0]?.turns).toEqual(history)
  })

  it('2 回目の呼び出しでセッションを作り直さない', async () => {
    const { chat, factory } = build()

    await complete(chat)
    await complete(chat)

    // 5GB のモデルの読み込みは十数秒かかる。ターンごとに作り直しては会話にならない。
    expect(factory.created).toBe(1)
    expect(factory.session.prompts).toHaveLength(2)
  })

  it('モデルのパスが空ならセッションを作らずに断る', async () => {
    const { chat, factory } = build('')

    await expect(complete(chat)).rejects.toBeInstanceOf(ChatError)
    expect(factory.created).toBe(0)
  })

  it('設定のコンテキスト長をそのままセッションに渡す', async () => {
    const { chat, factory } = build()

    await complete(chat)

    expect(factory.configs[0]?.contextSize).toBe(32_768)
  })

  it('dispose でセッションを解放し、次の呼び出しで作り直す', async () => {
    const { chat, factory } = build()

    await complete(chat)
    await chat.dispose()
    await complete(chat)

    expect(factory.session.disposed).toBe(1)
    expect(factory.created).toBe(2)
  })

  it('セッションを作っていなければ dispose は何もしない', async () => {
    const { chat, factory } = build()

    await chat.dispose()

    expect(factory.created).toBe(0)
  })
})
