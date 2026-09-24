import { describe, expect, it } from 'vitest'
import { PipelineClient, type PipelineWorker } from '../../src/main/worker/PipelineClient'

/** utilityProcess の代役。ジョブの完了・終了を手で起こせるようにする。 */
class FakeWorker implements PipelineWorker {
  readonly sent: { type: string; jobId: string }[] = []
  killed = false
  private listeners = new Map<string, ((value: never) => void)[]>()

  postMessage(message: unknown): void {
    this.sent.push(message as { type: string; jobId: string })
  }

  on(event: string, listener: (value: never) => void): this {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }

  kill(): boolean {
    this.killed = true
    this.emit('exit', 0)
    return true
  }

  emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never)
  }

  complete(jobId: string): void {
    this.emit('message', { type: 'done', jobId, recording: { id: 'r1' } })
  }

  fail(jobId: string): void {
    this.emit('message', { type: 'error', jobId, message: 'だめでした' })
  }
}

const setup = (): { client: PipelineClient; workers: FakeWorker[] } => {
  const workers: FakeWorker[] = []
  const client = new PipelineClient(
    () => undefined,
    () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    }
  )
  return { client, workers }
}

describe('PipelineClient', () => {
  it('ジョブが終わったらワーカーを終了させ、次のジョブは新しいワーカーで動かす', async () => {
    const { client, workers } = setup()

    const first = client.run({ recordingId: 'r1' })
    workers[0]?.complete(workers[0].sent[0]?.jobId ?? '')
    await first

    expect(workers[0]?.killed).toBe(true)

    const second = client.run({ recordingId: 'r2' })
    expect(workers).toHaveLength(2)
    workers[1]?.complete(workers[1].sent[0]?.jobId ?? '')
    await second
  })

  it('失敗で終わってもワーカーを残さない', async () => {
    const { client, workers } = setup()

    const job = client.run({ recordingId: 'r1' })
    workers[0]?.fail(workers[0].sent[0]?.jobId ?? '')

    await expect(job).rejects.toThrow('だめでした')
    expect(workers[0]?.killed).toBe(true)
  })

  it('続けて依頼しても、前のジョブが終わるまで次は投げない', () => {
    const { client, workers } = setup()

    void client.run({ recordingId: 'r1' })
    void client.run({ recordingId: 'r2' })

    expect(workers).toHaveLength(1)
    expect(workers[0]?.sent).toHaveLength(1)
  })

  it('待っていたジョブは、前のワーカーを終了させてから新しいワーカーで動かす', async () => {
    const { client, workers } = setup()

    const first = client.run({ recordingId: 'r1' })
    const second = client.run({ recordingId: 'r2' })

    workers[0]?.complete(workers[0].sent[0]?.jobId ?? '')
    await first

    expect(workers[0]?.killed).toBe(true)
    expect(workers).toHaveLength(2)
    expect(workers[1]?.sent[0]).toMatchObject({ type: 'run', recordingId: 'r2' })

    workers[1]?.complete(workers[1].sent[0]?.jobId ?? '')
    await second
    expect(workers[1]?.killed).toBe(true)
  })

  it('声紋の取り直しもパイプラインと同じ列に並ぶ', async () => {
    const { client, workers } = setup()

    const run = client.run({ recordingId: 'r1' })
    const voices = client.extractVoices('r2')
    expect(workers).toHaveLength(1)

    workers[0]?.complete(workers[0].sent[0]?.jobId ?? '')
    await run

    expect(workers[1]?.sent[0]).toMatchObject({ type: 'voices', recordingId: 'r2' })
    workers[1]?.emit('message', { type: 'voices-done', jobId: workers[1].sent[0]?.jobId })
    await voices
  })

  it('ワーカーが落ちても失敗させるのは実行中のジョブだけで、待っていたジョブは続ける', async () => {
    const { client, workers } = setup()

    const first = client.run({ recordingId: 'r1' })
    const second = client.run({ recordingId: 'r2' })

    workers[0]?.emit('exit', 1)
    await expect(first).rejects.toThrow('処理プロセスが終了しました')

    expect(workers).toHaveLength(2)
    workers[1]?.complete(workers[1].sent[0]?.jobId ?? '')
    await expect(second).resolves.toMatchObject({ id: 'r1' })
  })

  it('ジョブを抱えている間だけ busy を知らせる（検索の同期を譲らせるため）', async () => {
    const { client, workers } = setup()
    const changes: boolean[] = []
    client.onBusyChange((busy) => changes.push(busy))

    const first = client.run({ recordingId: 'r1' })
    const second = client.run({ recordingId: 'r2' })
    expect(client.isBusy()).toBe(true)

    workers[0]?.complete(workers[0].sent[0]?.jobId ?? '')
    await first
    // ジョブの合間に idle を挟まない。挟むと検索の同期が動き出し、すぐまた止められる。
    expect(client.isBusy()).toBe(true)
    workers[1]?.complete(workers[1].sent[0]?.jobId ?? '')
    await second

    expect(changes).toEqual([true, false])
    expect(client.isBusy()).toBe(false)
  })

  it('ワーカーが落ちて待機中のジョブが消えたときも idle を知らせる', async () => {
    const { client, workers } = setup()
    const changes: boolean[] = []
    client.onBusyChange((busy) => changes.push(busy))

    const job = client.run({ recordingId: 'r1' })
    workers[0]?.emit('exit', 1)

    await expect(job).rejects.toThrow()
    expect(changes).toEqual([true, false])
  })
})
