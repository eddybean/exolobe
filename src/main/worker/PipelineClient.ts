import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, utilityProcess } from 'electron'
import type { ProgressEventDto, RecordingDto } from '@shared/ipc'
import { isWorkerResponse } from './protocol'

/** utilityProcess のうち、このクラスが使う部分だけ。テストで差し替えられるようにする。 */
export interface PipelineWorker {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  kill(): boolean
}

/**
 * パイプラインワーカーとのやり取りを担う。
 *
 * ワーカーは必要になったときに起動し、落ちたら次の依頼で作り直す。ネイティブ
 * ライブラリのクラッシュで処理中のジョブは失われるが、その事実を利用者に返せる
 * ようにし、録音済みファイルと録音の状態はディスクに残ったままにする。
 *
 * 依頼が片付いたらワーカーを終了させ、次の依頼では新しいプロセスを起こす。
 * 話者識別の sherpa-onnx は WASM で、そのヒープは一度伸びると縮まず上限も 2GB
 * しかない。要約の LLM も同じプロセスに数 GB を確保する。使い回すと確保できる
 * メモリが目減りしていき、「memory access out of bounds」等で話者識別だけが
 * 落ちるようになるため、1 プロセス 1 ジョブで OS に返す。依存の組み立ては
 * ジョブごとに行っているので、作り直しても失うものは無い。
 */
export class PipelineClient {
  private worker: PipelineWorker | undefined
  private readonly pending = new Map<
    string,
    { resolve: (recording: RecordingDto) => void; reject: (error: Error) => void }
  >()

  constructor(
    private readonly onProgress: (event: ProgressEventDto) => void,
    private readonly fork: () => PipelineWorker = forkPipelineWorker
  ) {}

  async run(params: { recordingId: string; only?: readonly string[] }): Promise<RecordingDto> {
    const worker = this.ensureWorker()
    const jobId = randomUUID()

    return new Promise<RecordingDto>((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject })
      worker.postMessage({
        type: 'run',
        jobId,
        recordingId: params.recordingId,
        ...(params.only === undefined ? {} : { only: params.only })
      })
    })
  }

  dispose(): void {
    this.worker?.kill()
    this.worker = undefined
  }

  private ensureWorker(): PipelineWorker {
    if (this.worker) return this.worker

    const worker = this.fork()

    worker.on('message', (message: unknown) => {
      if (!isWorkerResponse(message)) return

      if (message.type === 'progress') {
        this.onProgress(message.event)
        return
      }

      const waiting = this.pending.get(message.jobId)
      this.pending.delete(message.jobId)

      if (message.type === 'done') waiting?.resolve(message.recording)
      else waiting?.reject(new Error(message.message))

      this.recycle(worker)
    })

    worker.on('exit', () => {
      if (this.worker === worker) this.worker = undefined
      // 待機中のジョブは結果を受け取れないので、理由を伝えて解放する。
      for (const [, waiting] of this.pending) {
        waiting.reject(
          new Error('処理プロセスが終了しました。詳細画面から失敗したステップを再実行してください。')
        )
      }
      this.pending.clear()
    })

    this.worker = worker
    return worker
  }

  /** 依頼が全て片付いていればワーカーを終了させ、確保したメモリを OS に返す。 */
  private recycle(worker: PipelineWorker): void {
    if (this.pending.size > 0) return
    if (this.worker !== worker) return

    this.worker = undefined
    worker.kill()
  }
}

const forkPipelineWorker = (): PipelineWorker =>
  utilityProcess.fork(join(__dirname, 'pipeline-worker.js'), [], {
    // ワーカーは electron API を持たないため、必要なパスは環境変数で渡す。
    env: {
      ...process.env,
      OMR_USER_DATA: app.getPath('userData'),
      // 同梱した whisper-cli の場所。開発中は空になり PATH 上の物が使われる。
      ...(app.isPackaged ? { OMR_RESOURCES: process.resourcesPath } : {})
    },
    stdio: 'inherit'
  })
