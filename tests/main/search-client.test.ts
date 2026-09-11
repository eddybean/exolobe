import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipelineWorker } from '../../src/main/worker/PipelineClient'
import { SearchClient } from '../../src/main/worker/SearchClient'
import {
  isSearchWorkerRequest,
  isSearchWorkerResponse,
  type SearchWorkerRequest
} from '../../src/main/worker/search-protocol'

const IDLE_MS = 180_000

/** utilityProcess の代役。応答と終了を手で起こせるようにする。 */
class FakeWorker implements PipelineWorker {
  readonly sent: SearchWorkerRequest[] = []
  killed = false
  private listeners = new Map<string, ((value: never) => void)[]>()

  postMessage(message: unknown): void {
    if (isSearchWorkerRequest(message)) this.sent.push(message)
  }

  on(event: string, listener: (value: never) => void): this {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }

  kill(): boolean {
    this.killed = true
    // 本物の utilityProcess と同じく、exit は kill の後で非同期に届く。
    queueMicrotask(() => this.emit('exit', 0))
    return true
  }

  emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never)
  }

  lastId(): string {
    const last = this.sent.at(-1)
    return last !== undefined && 'id' in last ? last.id : ''
  }
}

let workers: FakeWorker[]
let client: SearchClient

beforeEach(() => {
  vi.useFakeTimers()
  workers = []
  client = new SearchClient(
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

const hit = {
  recordingId: 'rec-1',
  title: '定例',
  startedAt: '2026-09-01T01:00:00.000Z',
  score: 0.62,
  source: 'transcript' as const,
  excerpt: '雨ですね'
}

describe('SearchClient', () => {
  it('検索をワーカーに頼み、結果を受け取る', async () => {
    const pending = client.search('天気の話', 20)
    const worker = workers[0]

    expect(worker?.sent[0]).toMatchObject({ type: 'search', query: '天気の話', limit: 20 })
    worker?.emit('message', { type: 'search-result', id: worker.lastId(), hits: [hit] })

    await expect(pending).resolves.toEqual([hit])
  })

  it('同期の進捗を渡し、結果を受け取る', async () => {
    const progress: [number, number][] = []
    const pending = client.sync((done, total) => progress.push([done, total]))
    const worker = workers[0]
    const id = worker?.lastId() ?? ''

    worker?.emit('message', { type: 'sync-progress', id, done: 1, total: 2 })
    const result = { indexed: 2, removed: 0, failed: 0, aborted: false }
    worker?.emit('message', { type: 'sync-done', id, result })

    await expect(pending).resolves.toEqual(result)
    expect(progress).toEqual([[1, 2]])
  })

  it('ワーカーが失敗を返したら理由付きで失敗させる', async () => {
    const pending = client.search('天気', 20)
    const worker = workers[0]
    worker?.emit('message', { type: 'error', id: worker.lastId(), message: 'モデルがありません' })

    await expect(pending).rejects.toThrow('モデルがありません')
  })

  it('使われないまま一定時間たったらワーカーを終わらせ、メモリを返す', async () => {
    const pending = client.search('天気', 20)
    const worker = workers[0]
    worker?.emit('message', { type: 'search-result', id: worker.lastId(), hits: [] })
    await pending

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    expect(worker?.killed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(worker?.killed).toBe(true)
  })

  it('続けて検索すればモデルを読み込み直さず同じワーカーを使う', async () => {
    const first = client.search('天気', 20)
    const worker = workers[0]
    worker?.emit('message', { type: 'search-result', id: worker.lastId(), hits: [] })
    await first
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)

    const second = client.search('雨', 20)
    worker?.emit('message', { type: 'search-result', id: worker.lastId(), hits: [] })
    await second
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)

    expect(workers).toHaveLength(1)
    expect(worker?.killed).toBe(false)
  })

  it('依頼を抱えている間はアイドル扱いにしない', async () => {
    void client.sync(() => undefined)

    await vi.advanceTimersByTimeAsync(IDLE_MS * 2)

    expect(workers[0]?.killed).toBe(false)
  })

  it('解放を頼まれたら、抱えている依頼が片付き次第すぐ終わらせる', async () => {
    const pending = client.search('天気', 20)
    const worker = workers[0]

    client.releaseWhenIdle()
    expect(worker?.killed).toBe(false)
    worker?.emit('message', { type: 'search-result', id: worker.lastId(), hits: [] })
    await pending

    expect(worker?.killed).toBe(true)
  })

  it('何も抱えていなければ解放はすぐ終わらせる', async () => {
    const pending = client.search('天気', 20)
    const worker = workers[0]
    worker?.emit('message', { type: 'search-result', id: worker.lastId(), hits: [] })
    await pending

    client.releaseWhenIdle()

    expect(worker?.killed).toBe(true)
  })

  it('shutdown はワーカーが終わるまで待ち、次の依頼では新しく起こす', async () => {
    void client.search('天気', 20).catch(() => undefined)

    await client.shutdown()

    expect(workers[0]?.killed).toBe(true)
    void client.search('雨', 20).catch(() => undefined)
    expect(workers).toHaveLength(2)
  })

  it('止めたワーカーの終了が、その後に起こしたワーカーへの依頼を巻き込まない', async () => {
    void client.search('天気', 20).catch(() => undefined)
    const stopped = client.shutdown()
    const next = client.search('雨', 20)

    await stopped
    const worker = workers[1]
    worker?.emit('message', { type: 'search-result', id: worker.lastId(), hits: [hit] })

    await expect(next).resolves.toEqual([hit])
  })

  it('ワーカーが落ちたら待機中の依頼を失敗させる', async () => {
    const pending = client.search('天気', 20)

    workers[0]?.emit('exit', 1)

    await expect(pending).rejects.toThrow('検索用のプロセスが終了しました')
  })

  it('同期の中断はワーカーが居るときだけ伝える（中断のために起こさない）', () => {
    client.cancelSync()
    expect(workers).toHaveLength(0)

    void client.sync(() => undefined)
    client.cancelSync()

    expect(workers[0]?.sent.at(-1)).toEqual({ type: 'cancel-sync' })
  })
})

describe('search-protocol', () => {
  it('形の合わないメッセージを弾く', () => {
    expect(isSearchWorkerRequest({ type: 'search', id: 'a', query: 'q', limit: 1 })).toBe(true)
    expect(isSearchWorkerRequest({ type: 'search', id: 'a' })).toBe(false)
    expect(isSearchWorkerRequest({ type: 'sync', id: 'a' })).toBe(true)
    expect(isSearchWorkerRequest({ type: 'cancel-sync' })).toBe(true)
    expect(isSearchWorkerRequest(null)).toBe(false)

    expect(isSearchWorkerResponse({ type: 'sync-done', id: 'a', result: {} })).toBe(true)
    expect(isSearchWorkerResponse({ type: 'run' })).toBe(false)
  })
})
