import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import type { ProgressEventDto, RecordingDto } from '@shared/ipc'
import { isWorkerResponse } from './protocol'

/**
 * パイプラインワーカーとのやり取りを担う。
 *
 * ワーカーは必要になったときに起動し、落ちたら次の依頼で作り直す。ネイティブ
 * ライブラリのクラッシュで処理中のジョブは失われるが、その事実を利用者に返せる
 * ようにし、録音済みファイルと録音の状態はディスクに残ったままにする。
 */
export class PipelineClient {
  private worker: UtilityProcess | undefined
  private readonly pending = new Map<
    string,
    { resolve: (recording: RecordingDto) => void; reject: (error: Error) => void }
  >()

  constructor(private readonly onProgress: (event: ProgressEventDto) => void) {}

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

  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker

    const worker = utilityProcess.fork(join(__dirname, 'pipeline-worker.js'), [], {
      // ワーカーは electron API を持たないため、必要なパスは環境変数で渡す。
      env: { ...process.env, OMR_USER_DATA: app.getPath('userData') },
      stdio: 'inherit'
    })

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
    })

    worker.on('exit', () => {
      this.worker = undefined
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
}
