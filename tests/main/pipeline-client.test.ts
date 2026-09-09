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

  it('待機中のジョブが残っているうちは終了させない', async () => {
    const { client, workers } = setup()

    const first = client.run({ recordingId: 'r1' })
    const second = client.run({ recordingId: 'r2' })
    const worker = workers[0]

    worker?.complete(worker.sent[0]?.jobId ?? '')
    await first
    expect(worker?.killed).toBe(false)

    worker?.complete(worker.sent[1]?.jobId ?? '')
    await second
    expect(worker?.killed).toBe(true)
  })
})
