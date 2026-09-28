import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, utilityProcess } from 'electron'
import { PIPELINE_STEPS, type PipelineStep } from '@domain/Recording'
import type { ProgressEventDto, RecordingDto } from '@shared/ipc'
import { isWorkerResponse } from './protocol'
import { text } from '../i18n'
import { errorFromWorker } from './workerError'

/** utilityProcess のうち、このクラスが使う部分だけ。テストで差し替えられるようにする。 */
export interface PipelineWorker {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  kill(): boolean
}

interface Job {
  readonly build: (jobId: string) => Record<string, unknown>
  /** まだ始まっていないステップ。パイプラインのジョブだけが持つ。 */
  readonly queued?: { readonly recordingId: string; readonly steps: Set<PipelineStep> }
  readonly resolve: (recording: RecordingDto | undefined) => void
  readonly reject: (error: Error) => void
}

/**
 * パイプラインワーカーとのやり取りを担う。
 *
 * ワーカーは必要になったときに起動し、落ちたら次の依頼で作り直す。ネイティブ
 * ライブラリのクラッシュで処理中のジョブは失われるが、その事実を利用者に返せる
 * ようにし、録音済みファイルと録音の状態はディスクに残ったままにする。
 *
 * 1 プロセスには 1 ジョブしか渡さない（ADR-008）。話者識別と要約のネイティブが
 * 確保した数 GB は、プロセスを終わらせるのが確実に OS へ返す方法だから。依頼は
 * ここで列に並べ、前のジョブのワーカーを終了させてから次のワーカーを起こす。
 * 列を呼び出し側に持たせると、録音停止・取り込み・ステップの再実行・声紋の
 * 取り直しと入口が増えるたびに守り漏れが出るため、唯一の入口であるここで持つ。
 * 依存の組み立てはジョブごとに行っているので、作り直しても失うものは無い。
 */
export class PipelineClient {
  private worker: PipelineWorker | undefined
  private current: { readonly jobId: string; readonly job: Job } | undefined
  private readonly queue: Job[] = []
  private readonly busyListeners: ((busy: boolean) => void)[] = []
  private readonly queueClearedListeners: ((recordingId: string) => void)[] = []

  constructor(
    private readonly onProgress: (event: ProgressEventDto) => void,
    private readonly fork: () => PipelineWorker = forkPipelineWorker,
    /**
     * ワーカーが落ちたとき、実行中のまま保存に残ったステップを直す。
     * 落ちたワーカーは自分のステップを running から書き換えられないため、ここで引き受ける。
     */
    private readonly recoverInterrupted: () => Promise<void> = async () => undefined
  ) {}

  async run(params: { recordingId: string; only?: readonly string[] }): Promise<RecordingDto> {
    const steps = PIPELINE_STEPS.filter((step) => params.only?.includes(step) ?? true)
    const recording = await this.request(
      (jobId) => ({
        type: 'run',
        jobId,
        recordingId: params.recordingId,
        ...(params.only === undefined ? {} : { only: params.only })
      }),
      { recordingId: params.recordingId, steps: new Set(steps) }
    )

    if (!recording) throw new Error(text().error.pipelineNoResult)
    return recording
  }

  /**
   * 列に積まれて、まだワーカーが手を付けていないステップ（パイプラインの順）。
   *
   * 保存された状態には載らない一過性の値なので、画面に渡す DTO へここから重ねる。
   * 保存しないのは、アプリが落ちると列ごと消えるため ―― 「順番待ち」が残ると
   * 二度と始まらない処理を待たせることになる。
   */
  queuedSteps(recordingId: string): PipelineStep[] {
    const jobs = [...(this.current ? [this.current.job] : []), ...this.queue]
    return PIPELINE_STEPS.filter((step) =>
      jobs.some((job) => job.queued?.recordingId === recordingId && job.queued.steps.has(step))
    )
  }

  /**
   * 完了済みの録音から声紋を取り直す。
   *
   * 話者に名前を付けたときに、その録音の声紋が無ければ呼ばれる。ジョブを抱えている
   * 間は busy になるので、意味検索の索引作成は自動的に待つ。
   */
  async extractVoices(recordingId: string): Promise<void> {
    await this.request((jobId) => ({ type: 'voices', jobId, recordingId }))
  }

  private request(
    build: (jobId: string) => Record<string, unknown>,
    queued?: Job['queued']
  ): Promise<RecordingDto | undefined> {
    return new Promise<RecordingDto | undefined>((resolve, reject) => {
      const wasBusy = this.isBusy()
      this.queue.push({ build, resolve, reject, ...(queued === undefined ? {} : { queued }) })
      if (!wasBusy) this.notifyBusy(true)
      if (queued) {
        for (const step of queued.steps) {
          this.onProgress({ recordingId: queued.recordingId, step, status: 'queued' })
        }
      }
      this.dispatch()
    })
  }

  /**
   * 実行中か、順番を待つジョブがある間か。意味検索の索引作成はこの間は待たせる。
   * 要約のような数 GB のモデルと同時に埋め込みモデルを載せないため。ジョブの合間も
   * busy のままにし、同期が動き出してすぐ止められる無駄を作らない。
   */
  isBusy(): boolean {
    return this.current !== undefined || this.queue.length > 0
  }

  onBusyChange(listener: (busy: boolean) => void): void {
    this.busyListeners.push(listener)
  }

  /**
   * ジョブが終わり、進捗を報せないまま順番待ちが消えたとき。前のステップの失敗で
   * 実行しなかった・ワーカーが途中で落ちた、などの場合で、画面はこれを受けて
   * 読み直さないと「順番待ち」を出し続ける。
   */
  onQueueCleared(listener: (recordingId: string) => void): void {
    this.queueClearedListeners.push(listener)
  }

  dispose(): void {
    this.worker?.kill()
    this.worker = undefined
  }

  /** 何も動いていなければ、列の先頭を新しいワーカーで始める。 */
  private dispatch(): void {
    if (this.current) return
    const job = this.queue.shift()
    if (!job) return

    const jobId = randomUUID()
    this.current = { jobId, job }
    this.ensureWorker().postMessage(job.build(jobId))
  }

  private ensureWorker(): PipelineWorker {
    if (this.worker) return this.worker

    const worker = this.fork()

    worker.on('message', (message: unknown) => {
      if (!isWorkerResponse(message)) return

      if (message.type === 'progress') {
        // 進捗が届いたステップは保存された状態の方が実態を表すので、順番待ちから外す。
        const queued = this.current?.job.queued
        if (queued?.recordingId === message.event.recordingId) {
          queued.steps.delete(message.event.step)
        }
        this.onProgress(message.event)
        return
      }

      if (this.worker !== worker || this.current?.jobId !== message.jobId) return
      const { job } = this.current

      if (message.type === 'done') job.resolve(message.recording)
      else if (message.type === 'voices-done') job.resolve(undefined)
      else job.reject(errorFromWorker(message))

      this.finish(worker)
    })

    worker.on('exit', () => {
      // 終わらせたのが自分なら、ジョブは既に片付いている。
      if (this.worker !== worker) return

      // 直し終えるまで current を持ったままにし、次のジョブを始めさせない。始めた後だと
      // そのジョブが保存した running まで失敗にしてしまう。失敗させるのも直した後にする。
      // 先に知らせると、画面が読み直したときにまだ「処理中」が見えてしまう。
      void this.recoverInterrupted()
        .catch(() => undefined)
        .then(() => {
          // 失われるのは実行中のジョブだけ。待っていたジョブは新しいワーカーで続ける。
          this.current?.job.reject(new Error(text().error.pipelineExited))
          this.finish(worker)
        })
    })

    this.worker = worker
    return worker
  }

  /** ワーカーを終了させて確保したメモリを OS に返し、次のジョブへ進む。 */
  private finish(worker: PipelineWorker): void {
    const queued = this.current?.job.queued
    this.current = undefined
    this.worker = undefined
    worker.kill()

    if (queued && queued.steps.size > 0) {
      for (const listener of this.queueClearedListeners) listener(queued.recordingId)
    }

    this.dispatch()
    if (!this.isBusy()) this.notifyBusy(false)
  }

  private notifyBusy(busy: boolean): void {
    for (const listener of this.busyListeners) listener(busy)
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
