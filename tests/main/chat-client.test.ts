import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatAnswerDto } from '@shared/ipc'
import type { PipelineWorker } from '../../src/main/worker/PipelineClient'
import { ChatClient } from '../../src/main/worker/ChatClient'
import { isChatWorkerRequest, type ChatWorkerRequest } from '../../src/main/worker/chat-protocol'

const IDLE_MS = 120_000

/** utilityProcess の代役。応答と終了を手で起こせるようにする。 */
class FakeWorker implements PipelineWorker {
  readonly sent: ChatWorkerRequest[] = []
  killed = false
  private listeners = new Map<string, ((value: never) => void)[]>()

  postMessage(message: unknown): void {
    if (isChatWorkerRequest(message)) this.sent.push(message)
  }

  on(event: string, listener: (value: never) => void): this {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }

  kill(): boolean {
    this.killed = true
    queueMicrotask(() => this.emit('exit', 0))
    return true
  }

  emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never)
  }

  lastId(): string {
    return this.sent.at(-1)?.id ?? ''
  }
}

const answer = (text: string): ChatAnswerDto => ({
  text,
  citations: [],
  usedTranscript: false,
  droppedCount: 0,
  truncated: false
})

let workers: FakeWorker[]
let client: ChatClient

beforeEach(() => {
  vi.useFakeTimers()
  workers = []
  client = new ChatClient(
    () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    { idleMs: IDLE_MS }
  )
})

afterEach(() => {
  vi.useRealTimers()
})

const ask = (question = '先週のTODOをまとめて', onChunk: (t: string) => void = () => {}) =>
  client.ask({ question, history: [], onChunk })

describe('ChatClient', () => {
  it('問いをワーカーに渡し、断片と答えを受け取る', async () => {
    const chunks: string[] = []
    const pending = ask('先週のTODOをまとめて', (text) => chunks.push(text))
    const worker = workers[0]
    const id = worker?.lastId() ?? ''

    expect(worker?.sent[0]).toMatchObject({ type: 'ask', question: '先週のTODOをまとめて' })
    worker?.emit('message', { type: 'chat-chunk', id, text: '見積' })
    worker?.emit('message', { type: 'chat-chunk', id, text: 'もりです' })
    worker?.emit('message', { type: 'chat-done', id, answer: answer('見積もりです') })

    await expect(pending).resolves.toMatchObject({ text: '見積もりです' })
    expect(chunks).toEqual(['見積', 'もりです'])
  })

  it('ワーカーが失敗を返したら理由付きで失敗させる', async () => {
    const pending = ask()
    const worker = workers[0]
    worker?.emit('message', { type: 'error', id: worker.lastId(), message: 'モデルがありません' })

    await expect(pending).rejects.toThrow('モデルがありません')
  })

  it('続けて尋ねればモデルを読み込み直さず同じワーカーを使う', async () => {
    const first = ask()
    const worker = workers[0]
    worker?.emit('message', { type: 'chat-done', id: worker.lastId(), answer: answer('1') })
    await first

    const second = ask()
    worker?.emit('message', { type: 'chat-done', id: worker.lastId(), answer: answer('2') })
    await second

    expect(workers).toHaveLength(1)
  })

  it('使われないまま一定時間たったらワーカーを終わらせ、メモリを返す', async () => {
    const pending = ask()
    const worker = workers[0]
    worker?.emit('message', { type: 'chat-done', id: worker.lastId(), answer: answer('答え') })
    await pending

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    expect(worker?.killed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(worker?.killed).toBe(true)
  })

  it('生成中は busy を返し、終われば戻る', async () => {
    expect(client.isBusy()).toBe(false)

    const pending = ask()
    expect(client.isBusy()).toBe(true)

    const worker = workers[0]
    worker?.emit('message', { type: 'chat-done', id: worker.lastId(), answer: answer('答え') })
    await pending

    expect(client.isBusy()).toBe(false)
  })

  it('新しい問いが来たら前の問いを中断してから始める', async () => {
    const first = ask('最初の問い')
    const worker = workers[0]
    const firstId = worker?.lastId() ?? ''

    const second = ask('次の問い')

    expect(worker?.sent[1]).toEqual({ type: 'cancel', id: firstId })
    worker?.emit('message', { type: 'chat-done', id: firstId, answer: answer('途中まで') })
    worker?.emit('message', { type: 'chat-done', id: worker.lastId(), answer: answer('答え') })

    await expect(first).resolves.toMatchObject({ text: '途中まで' })
    await expect(second).resolves.toMatchObject({ text: '答え' })
  })

  it('cancel は生成中の問いだけをワーカーに伝える', async () => {
    const pending = ask()
    const worker = workers[0]
    const id = worker?.lastId() ?? ''

    client.cancel(id)

    expect(worker?.sent.at(-1)).toEqual({ type: 'cancel', id })
    worker?.emit('message', { type: 'chat-done', id, answer: answer('途中まで') })
    await pending
  })

  it('中断のためにワーカーを起こさない', () => {
    client.cancel('存在しない依頼')

    expect(workers).toHaveLength(0)
  })

  it('ワーカーが落ちたら抱えている問いを失敗させる', async () => {
    const pending = ask()
    const worker = workers[0]

    worker?.emit('exit', 1)

    await expect(pending).rejects.toThrow('終了しました')
  })

  it('生成中に解放を頼まれたら、終わってからワーカーを終わらせる', async () => {
    const pending = ask()
    const worker = workers[0]

    client.releaseWhenIdle()
    expect(worker?.killed).toBe(false)

    worker?.emit('message', { type: 'chat-done', id: worker.lastId(), answer: answer('答え') })
    await pending

    expect(worker?.killed).toBe(true)
  })

  it('候補の問い合わせを main へ委ね、答えをワーカーへ返す', async () => {
    const topics: { topic: string; limit: number }[] = []
    client.onFindCandidates(async (params) => {
      topics.push({ topic: params.topic, limit: params.limit })
      return ['rec-1']
    })

    const pending = ask()
    const worker = workers[0]
    const id = worker?.lastId() ?? ''

    worker?.emit('message', { type: 'find-candidates', id, topic: '見積もり', limit: 24 })
    await vi.advanceTimersByTimeAsync(0)

    expect(topics).toEqual([{ topic: '見積もり', limit: 24 }])
    expect(worker?.sent.at(-1)).toEqual({ type: 'candidates', id, recordingIds: ['rec-1'] })

    worker?.emit('message', { type: 'chat-done', id, answer: answer('答え') })
    await pending
  })

  it('候補の問い合わせに応える相手が居なければ空を返す', async () => {
    const pending = ask()
    const worker = workers[0]
    const id = worker?.lastId() ?? ''

    worker?.emit('message', { type: 'find-candidates', id, topic: '見積もり', limit: 24 })
    await vi.advanceTimersByTimeAsync(0)

    expect(worker?.sent.at(-1)).toEqual({ type: 'candidates', id, recordingIds: [] })

    worker?.emit('message', { type: 'chat-done', id, answer: answer('答え') })
    await pending
  })

  it('shutdown はワーカーの終了を待つ', async () => {
    const pending = ask()
    const worker = workers[0]

    const closed = client.shutdown()
    await expect(pending).rejects.toThrow('終了しました')
    await closed

    expect(worker?.killed).toBe(true)
  })
})
