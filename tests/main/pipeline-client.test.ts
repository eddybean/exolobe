import { describe, expect, it } from 'vitest'
import type { ProgressEventDto } from '@shared/ipc'
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

const setup = (): {
  client: PipelineClient
  workers: FakeWorker[]
  events: ProgressEventDto[]
} => {
  const workers: FakeWorker[] = []
  const events: ProgressEventDto[] = []
  const client = new PipelineClient(
    (event) => events.push(event),
    () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    }
  )
  return { client, workers, events }
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

  describe('ワーカーが落ちたときの後始末', () => {
    const setupWithRecovery = (recover: () => Promise<void>): { client: PipelineClient; workers: FakeWorker[] } => {
      const workers: FakeWorker[] = []
      const client = new PipelineClient(
        () => undefined,
        () => {
          const worker = new FakeWorker()
          workers.push(worker)
          return worker
        },
        recover
      )
      return { client, workers }
    }

    it('実行中のまま残った状態を直し終えてから、ジョブを失敗させて次のジョブへ進む', async () => {
      let finishRecovery = (): void => undefined
      const recovered = new Promise<void>((resolve) => (finishRecovery = resolve))
      const order: string[] = []
      const { client, workers } = setupWithRecovery(async () => {
        order.push('recover')
        await recovered
      })

      const first = client.run({ recordingId: 'r1' }).catch(() => order.push('rejected'))
      const second = client.run({ recordingId: 'r2' })
      workers[0]?.emit('exit', 1)

      // 直している間に次のジョブが走り出すと、そのステップの running まで失敗にしてしまう。
      expect(workers).toHaveLength(1)

      finishRecovery()
      await first
      expect(order).toEqual(['recover', 'rejected'])
      expect(workers).toHaveLength(2)

      workers[1]?.complete(workers[1].sent[0]?.jobId ?? '')
      await second
    })

    it('直すのに失敗しても列は止めない', async () => {
      const { client, workers } = setupWithRecovery(async () => {
        throw new Error('書けませんでした')
      })

      const first = client.run({ recordingId: 'r1' })
      const second = client.run({ recordingId: 'r2' })
      workers[0]?.emit('exit', 1)

      await expect(first).rejects.toThrow('処理プロセスが終了しました')
      workers[1]?.complete(workers[1].sent[0]?.jobId ?? '')
      await second
    })

    it('自分で終わらせたワーカーでは直さない（ジョブは片付いている）', async () => {
      const calls: string[] = []
      const { client, workers } = setupWithRecovery(async () => {
        calls.push('recover')
      })

      const job = client.run({ recordingId: 'r1' })
      workers[0]?.complete(workers[0].sent[0]?.jobId ?? '')
      await job

      expect(calls).toEqual([])
    })
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

  describe('順番待ちのステップ', () => {
    it('積んだ時点で queued を知らせる（押した直後に受け付けたと分かるように）', () => {
      const { client, events } = setup()

      void client.run({ recordingId: 'r1', only: ['summarize'] })

      expect(events).toEqual([{ recordingId: 'r1', step: 'summarize', status: 'queued' }])
      expect(client.queuedSteps('r1')).toEqual(['summarize'])
    })

    it('ステップを指定しない依頼は全ステップを順番待ちにする', () => {
      const { client } = setup()

      void client.run({ recordingId: 'r1' })

      expect(client.queuedSteps('r1')).toEqual(['mix', 'transcribe', 'diarize', 'summarize', 'encode'])
    })

    it('前のジョブを待っている間も順番待ちのまま', () => {
      const { client } = setup()

      void client.run({ recordingId: 'r1' })
      void client.run({ recordingId: 'r2', only: ['summarize'] })

      expect(client.queuedSteps('r2')).toEqual(['summarize'])
    })

    it('ワーカーがそのステップの進捗を報せたら順番待ちから外す', () => {
      const { client, workers, events } = setup()

      void client.run({ recordingId: 'r1', only: ['diarize', 'summarize'] })
      const running = { recordingId: 'r1', step: 'diarize', status: 'running' } as const
      workers[0]?.emit('message', { type: 'progress', event: running })

      expect(client.queuedSteps('r1')).toEqual(['summarize'])
      expect(events).toContainEqual(running)
    })

    it('ジョブが終われば、進捗を報せずに終わったステップも順番待ちから外す', async () => {
      // 前のステップの失敗で実行しなかったステップは進捗を報せない。
      const { client, workers } = setup()

      const job = client.run({ recordingId: 'r1', only: ['summarize'] })
      workers[0]?.complete(workers[0].sent[0]?.jobId ?? '')
      await job

      expect(client.queuedSteps('r1')).toEqual([])
    })

    it('ワーカーが落ちたら実行中のジョブの分だけ外し、待っていた分は残す', async () => {
      const { client, workers } = setup()

      const first = client.run({ recordingId: 'r1', only: ['summarize'] })
      void client.run({ recordingId: 'r2', only: ['summarize'] })
      workers[0]?.emit('exit', 1)
      await expect(first).rejects.toThrow()

      expect(client.queuedSteps('r1')).toEqual([])
      expect(client.queuedSteps('r2')).toEqual(['summarize'])
    })

    it('ジョブが失敗で終わって順番待ちが消えたことも知らせる（画面に残り続けないように）', async () => {
      const { client, workers } = setup()
      const cleared: string[] = []
      client.onQueueCleared((recordingId) => cleared.push(recordingId))

      const job = client.run({ recordingId: 'r1', only: ['summarize'] })
      workers[0]?.fail(workers[0].sent[0]?.jobId ?? '')
      await expect(job).rejects.toThrow()

      expect(cleared).toEqual(['r1'])
    })

    it('ワーカーが落ちたときも、実行中だったジョブの順番待ちが消えたことを知らせる', async () => {
      const { client, workers } = setup()
      const cleared: string[] = []
      client.onQueueCleared((recordingId) => cleared.push(recordingId))

      const job = client.run({ recordingId: 'r1', only: ['summarize'] })
      workers[0]?.emit('exit', 1)
      await expect(job).rejects.toThrow()

      expect(cleared).toEqual(['r1'])
    })

    it('全ステップが進捗を報せ終えていれば、改めては知らせない', async () => {
      const { client, workers } = setup()
      const cleared: string[] = []
      client.onQueueCleared((recordingId) => cleared.push(recordingId))

      const job = client.run({ recordingId: 'r1', only: ['summarize'] })
      const done = { recordingId: 'r1', step: 'summarize', status: 'done' }
      workers[0]?.emit('message', { type: 'progress', event: done })
      workers[0]?.complete(workers[0].sent[0]?.jobId ?? '')
      await job

      expect(cleared).toEqual([])
    })

    it('声紋の取り直しはステップではないので順番待ちに出さない', () => {
      const { client, events } = setup()

      void client.extractVoices('r1')

      expect(client.queuedSteps('r1')).toEqual([])
      expect(events).toEqual([])
    })
  })
})
