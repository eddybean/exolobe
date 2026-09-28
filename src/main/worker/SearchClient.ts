import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, utilityProcess } from 'electron'
import type { SyncSearchIndexResult } from '@application/usecases/search'
import type { SearchHitDto } from '@shared/ipc'
import type { PipelineWorker } from './PipelineClient'
import { isSearchWorkerResponse, type SearchWorkerRequest } from './search-protocol'
import { UI_LOCALE_ENV } from '@shared/i18n/locale'
import { appLocale, text } from '../i18n'
import { errorFromWorker } from './workerError'

interface Waiting {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onProgress?: (done: number, total: number) => void
}

/**
 * 意味検索のワーカーとのやり取りを担う。
 *
 * パイプラインのワーカー（1 ジョブ 1 プロセス）とは別に立てる。
 * - 要約は数分かかる。同じワーカーの列に並ぶと、その間ずっと検索が待たされる。
 * - 検索は続けて打ち直すもの。1 回ごとにプロセスを起こして 600MB のモデルを
 *   読み直すと、そのたびに数秒待たされる。
 * そこで、使われている間は生かしてモデルを温めておき、しばらく使われなければ
 * 終わらせて OS にメモリを返す（ADR-008 の「確実に返す」はプロセスの終了で守る）。
 */
export class SearchClient {
  private worker: PipelineWorker | undefined
  private readonly pending = new Map<string, Waiting>()
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private releaseRequested = false
  private readonly idleMs: number

  constructor(
    private readonly fork: () => PipelineWorker = forkSearchWorker,
    options: { idleMs?: number } = {}
  ) {
    // 3 分。検索を何度か打ち直す間は温めておき、席を外したら返す長さ。
    this.idleMs = options.idleMs ?? 180_000
  }

  search(query: string, limit: number): Promise<SearchHitDto[]> {
    return this.request<SearchHitDto[]>((id) => ({ type: 'search', id, query, limit }))
  }

  sync(onProgress: (done: number, total: number) => void): Promise<SyncSearchIndexResult> {
    return this.request<SyncSearchIndexResult>((id) => ({ type: 'sync', id }), onProgress)
  }

  /** 中断のためだけにワーカーを起こしてモデルを読ませることはしない。 */
  cancelSync(): void {
    this.worker?.postMessage({ type: 'cancel-sync' } satisfies SearchWorkerRequest)
  }

  /**
   * 抱えている依頼が片付き次第、ワーカーを終わらせる。
   * 要約のような重い処理が始まる前に、埋め込みモデルの分のメモリを空けるため。
   */
  releaseWhenIdle(): void {
    if (!this.worker) return
    if (this.pending.size === 0) {
      this.terminate()
      return
    }
    this.releaseRequested = true
  }

  /** ワーカーを止め、終わるまで待つ。索引を消す前やモデルを差し替える前に呼ぶ。 */
  shutdown(): Promise<void> {
    const worker = this.worker
    if (!worker) return Promise.resolve()
    const exited = new Promise<void>((resolve) => worker.on('exit', () => resolve()))
    this.terminate()
    return exited
  }

  private request<T>(
    build: (id: string) => SearchWorkerRequest,
    onProgress?: (done: number, total: number) => void
  ): Promise<T> {
    const worker = this.ensureWorker()
    this.clearIdleTimer()
    const id = randomUUID()

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        ...(onProgress === undefined ? {} : { onProgress })
      })
      worker.postMessage(build(id))
    })
  }

  private ensureWorker(): PipelineWorker {
    if (this.worker) return this.worker

    const worker = this.fork()
    this.releaseRequested = false

    worker.on('message', (message: unknown) => {
      if (!isSearchWorkerResponse(message)) return
      const waiting = this.pending.get(message.id)
      if (!waiting) return

      switch (message.type) {
        case 'sync-progress':
          waiting.onProgress?.(message.done, message.total)
          return
        case 'search-result':
          waiting.resolve(message.hits)
          break
        case 'sync-done':
          waiting.resolve(message.result)
          break
        case 'error':
          waiting.reject(errorFromWorker(message))
          break
      }
      this.pending.delete(message.id)
      if (this.pending.size === 0) this.onDrained()
    })

    worker.on('exit', () => {
      // 自分で止めたワーカーの後始末は terminate で済んでいる。ここで扱うのは
      // 現役のワーカーが落ちた場合だけ。止めた後に起こした新しいワーカーへの
      // 依頼まで失敗させないため。
      if (this.worker !== worker) return
      this.worker = undefined
      this.clearIdleTimer()
      this.rejectPending()
    })

    this.worker = worker
    return worker
  }

  private onDrained(): void {
    if (this.releaseRequested) {
      this.terminate()
      return
    }
    this.idleTimer = setTimeout(() => this.terminate(), this.idleMs)
  }

  private terminate(): void {
    this.clearIdleTimer()
    this.releaseRequested = false
    const worker = this.worker
    this.worker = undefined
    this.rejectPending()
    worker?.kill()
  }

  private rejectPending(): void {
    for (const [, waiting] of this.pending) {
      waiting.reject(new Error(text().error.searchExited))
    }
    this.pending.clear()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }
}

const forkSearchWorker = (): PipelineWorker =>
  utilityProcess.fork(join(__dirname, 'search-worker.js'), [], {
    // ワーカーは electron API を持たないため、必要なパスは環境変数で渡す。
    env: {
      ...process.env,
      OMR_USER_DATA: app.getPath('userData'),
      [UI_LOCALE_ENV]: appLocale()
    },
    stdio: 'inherit'
  })
