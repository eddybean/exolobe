import { beforeEach, describe, expect, it } from 'vitest'
import { AskChat } from '@application/usecases/chat'
import { createRecording, startStep, type Recording } from '@domain/Recording'
import { AppError } from '@domain/errors'
import type { Speaker } from '@domain/Speaker'
import type { TranscriptSegment } from '@domain/TranscriptSegment'
import {
  FakeArtifactStore,
  FakeChatCompletion,
  FakeClock,
  FakeRecordingFinder,
  FakeRecordingRepository,
  FakeSettingsRepository,
  FakeSystemResource
} from './fakes'
import { chatPrompts } from '@domain/ChatPrompt'

/** 2026-09-13 は日曜。先週は 08-31〜09-06。 */
const NOW = new Date('2026-09-13T10:00:00+09:00')
const MODEL_PATH = '/models/gemma.gguf'

const speakers: Speaker[] = [
  { id: 'self', kind: 'self', label: '自分' },
  { id: 'remote:spk0', kind: 'remote', label: '田中' }
]

const ready = (id: string, startedAt: string, title: string): Recording => ({
  ...createRecording({ id, startedAt: new Date(startedAt), title }),
  status: 'ready'
})

const lastWeek = ready('rec-last', '2026-09-02T10:00:00+09:00', '先週の定例')
const twoWeeksAgo = ready('rec-older', '2026-08-26T10:00:00+09:00', '先々週の定例')

const segments: TranscriptSegment[] = [
  { startMs: 0, endMs: 1_000, speakerId: 'self', text: '見積もりは私が出します' },
  { startMs: 2_000, endMs: 3_000, speakerId: 'remote:spk0', text: '来週までにお願いします' }
]

let repository: FakeRecordingRepository
let artifacts: FakeArtifactStore
let settings: FakeSettingsRepository
let system: FakeSystemResource
let chat: FakeChatCompletion
let finder: FakeRecordingFinder

const build = async (options: { finder?: boolean } = {}): Promise<AskChat> => {
  repository = new FakeRecordingRepository()
  artifacts = new FakeArtifactStore()
  settings = new FakeSettingsRepository()
  system = new FakeSystemResource()
  chat = new FakeChatCompletion()
  finder = new FakeRecordingFinder()

  await settings.save({
    summarization: { modelPath: MODEL_PATH },
    search: { enabled: true, modelPath: '/models/bge-m3.gguf' }
  })
  system.sizes.set(MODEL_PATH, 5 * 1_024 ** 3)

  for (const recording of [lastWeek, twoWeeksAgo]) {
    await repository.save(recording)
    artifacts.summaries.set(recording.id, `## 決定事項\n- ${recording.title}の決定`)
    artifacts.transcripts.set(recording.id, { segments, speakers })
  }

  return new AskChat({
    repository,
    artifacts,
    settings,
    system,
    clock: new FakeClock(NOW),
    chat,
    ...(options.finder === true ? { finder } : {})
  })
}

const ask = async (askChat: AskChat, question: string) => askChat.execute({ question, history: [], onChunk: () => {} })

describe('AskChat — 期間で絞る', () => {
  let askChat: AskChat
  beforeEach(async () => {
    askChat = await build()
  })

  it('英語の問いには英語の指示文で答えさせる', async () => {
    await ask(askChat, 'What are the open TODOs?')

    expect(chat.calls[0]?.system).toBe(chatPrompts('en').system)
    expect(chat.calls[0]?.prompt).toContain('in English')
  })

  it('日本語の問いには日本語の指示文で答えさせる', async () => {
    await ask(askChat, '先週のTODOをまとめて')

    expect(chat.calls[0]?.system).toBe(chatPrompts('ja').system)
  })

  it('「先週の」は先週の録音だけを文脈に載せる', async () => {
    await ask(askChat, '先週のTODOをまとめて')
    const prompt = chat.calls[0]?.prompt ?? ''

    expect(prompt).toContain('先週の定例')
    expect(prompt).not.toContain('先々週の定例')
  })

  it('絞った期間を答えと一緒に返す', async () => {
    const answer = await ask(askChat, '先週のTODOをまとめて')

    expect(answer.scope).toEqual({ rangeLabel: expect.stringContaining('先週'), count: 1 })
    expect(answer.citations.map((c) => c.recordingId)).toEqual(['rec-last'])
  })

  it('期間の指定が無ければ全部の録音が対象になる', async () => {
    await ask(askChat, '決まったことは？')
    const prompt = chat.calls[0]?.prompt ?? ''

    expect(prompt).toContain('先週の定例')
    expect(prompt).toContain('先々週の定例')
  })

  it('該当する録音が無くてもモデルには尋ね、記録が無いことを伝える', async () => {
    const answer = await ask(askChat, '今日の会議をまとめて')

    expect(chat.calls[0]?.prompt).toContain('該当する会議の記録はありません')
    expect(answer.citations).toHaveLength(0)
  })

  it('処理中の録音は文脈に載せない', async () => {
    // 成果物がこれから書き換わるので、確定するまで読まない。
    await repository.save({
      ...lastWeek,
      status: 'processing',
      steps: startStep(lastWeek.steps, 'summarize')
    })
    await ask(askChat, '先週のTODOをまとめて')

    expect(chat.calls[0]?.prompt).not.toContain('先週の定例')
  })
})

describe('AskChat — 話者で絞る', () => {
  let askChat: AskChat
  beforeEach(async () => {
    askChat = await build()
  })

  it('「自分の発言だけ」は文字起こしから自分の発言だけを載せる', async () => {
    const answer = await ask(askChat, '先週の自分の発言だけを要約して')
    const prompt = chat.calls[0]?.prompt ?? ''

    expect(prompt).toContain('見積もりは私が出します')
    expect(prompt).not.toContain('来週までにお願いします')
    expect(answer.usedTranscript).toBe(true)
  })

  it('話者を絞らないときは文字起こしを読みに行かない', async () => {
    await ask(askChat, '先週のTODOをまとめて')

    expect(chat.calls[0]?.prompt).toContain('決定事項')
    expect(chat.calls[0]?.prompt).not.toContain('見積もりは私が出します')
  })
})

describe('AskChat — 話題で絞る', () => {
  it('話題語があれば finder に渡し、期間との積を取る', async () => {
    const askChat = await build({ finder: true })
    finder.ids = ['rec-older']

    await ask(askChat, '先週の見積もりの話をまとめて')

    expect(finder.calls[0]?.topic).toContain('見積もり')
    // finder は先々週の録音を返したが、先週という指定の外なので落とす。
    expect(chat.calls[0]?.prompt).not.toContain('先々週の定例')
    expect(chat.calls[0]?.prompt).not.toContain('先週の定例')
  })

  it('期間で絞った結果が空なら finder を呼ばない', async () => {
    const askChat = await build({ finder: true })

    await ask(askChat, '今日の見積もりの話をまとめて')

    expect(finder.calls).toHaveLength(0)
  })

  it('話題語が無ければ finder を呼ばない', async () => {
    const askChat = await build({ finder: true })

    await ask(askChat, '先週のことをまとめて')

    expect(finder.calls).toHaveLength(0)
  })

  it('意味検索が無効なら finder を呼ばず、期間で絞った結果で答える', async () => {
    const askChat = await build({ finder: true })
    // 検索が使えないのに話題語で絞ると、候補が空になって「記録が無い」と答えてしまう。
    await settings.save({ search: { enabled: false } })

    await ask(askChat, '先週の見積もりの話をまとめて')

    expect(finder.calls).toHaveLength(0)
    expect(chat.calls[0]?.prompt).toContain('先週の定例')
  })

  it('意味検索が有効でモデルもあれば finder を使う', async () => {
    const askChat = await build({ finder: true })
    await settings.save({ search: { enabled: true, modelPath: '/models/bge-m3.gguf' } })
    finder.ids = ['rec-last']

    await ask(askChat, '先週の見積もりの話をまとめて')

    expect(finder.calls).toHaveLength(1)
  })

  it('finder が無くても期間だけで答える', async () => {
    const askChat = await build()

    await ask(askChat, '先週の見積もりの話をまとめて')

    expect(chat.calls[0]?.prompt).toContain('先週の定例')
  })

  it('finder が失敗しても、期間で絞った結果で答える', async () => {
    const askChat = await build({ finder: true })
    finder.error = new Error('検索ワーカーが落ちました')

    await ask(askChat, '先週の見積もりの話をまとめて')

    expect(chat.calls[0]?.prompt).toContain('先週の定例')
  })
})

describe('AskChat — 件数の上限', () => {
  it('設定の上限を超える録音は載せず、落とした件数を返す', async () => {
    const askChat = await build()
    await settings.save({ chat: { maxRecordings: 1 } })

    const answer = await ask(askChat, '決まったことは？')

    expect(answer.citations).toHaveLength(1)
    expect(answer.droppedCount).toBe(1)
    // 新しい方から載せる。
    expect(answer.citations[0]?.recordingId).toBe('rec-last')
  })
})

describe('AskChat — メモリ', () => {
  it('空きが足りなければモデルを読まずに断る', async () => {
    const askChat = await build()
    system.snapshot = { totalBytes: 16 * 1_024 ** 3, availableBytes: 1 * 1_024 ** 3 }

    await expect(ask(askChat, '先週のTODOをまとめて')).rejects.toBeInstanceOf(AppError)
    expect(chat.calls).toHaveLength(0)
  })

  it('メモリ保護がオフなら確認しない', async () => {
    const askChat = await build()
    await settings.save({ memoryProtection: 'off' })
    system.snapshot = { totalBytes: 16 * 1_024 ** 3, availableBytes: 1 * 1_024 ** 3 }

    await ask(askChat, '先週のTODOをまとめて')

    expect(chat.calls).toHaveLength(1)
  })
})

describe('AskChat — 生成', () => {
  let askChat: AskChat
  beforeEach(async () => {
    askChat = await build()
  })

  it('断片を呼び出し側へ素通しし、連結を答えとして返す', async () => {
    const received: string[] = []
    const answer = await askChat.execute({
      question: '先週のTODOをまとめて',
      history: [],
      onChunk: (text) => received.push(text)
    })

    expect(received).toEqual(chat.chunks)
    expect(answer.text).toBe(chat.chunks.join(''))
  })

  it('会話履歴をそのままモデルに渡す', async () => {
    const history = [
      { role: 'user' as const, text: '先週のTODOは？' },
      { role: 'assistant' as const, text: '見積もりの提出です。' }
    ]

    await askChat.execute({ question: 'もっと詳しく', history, onChunk: () => {} })

    expect(chat.calls[0]?.history).toEqual(history)
  })

  it('文脈は履歴ではなく毎回のプロンプトに載せる', async () => {
    await askChat.execute({
      question: 'もっと詳しく',
      history: [{ role: 'user', text: '先週のTODOは？' }],
      onChunk: () => {}
    })

    expect(chat.calls[0]?.history[0]?.text).toBe('先週のTODOは？')
    expect(chat.calls[0]?.prompt).toContain('決定事項')
  })

  it('要約モデルが設定されていなければ、モデルを読まずに断る', async () => {
    await settings.save({ summarization: { modelPath: '' } })

    await expect(ask(askChat, '先週のTODOをまとめて')).rejects.toBeInstanceOf(AppError)
    expect(chat.calls).toHaveLength(0)
  })
})
