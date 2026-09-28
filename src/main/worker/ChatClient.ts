import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, utilityProcess } from 'electron'
import type { ChatTurn } from '@application/ports'
import type { ChatAnswerDto } from '@shared/ipc'
import type { PipelineWorker } from './PipelineClient'
import { isChatWorkerResponse, type ChatWorkerRequest } from './chat-protocol'
import { text } from '../i18n'
import { errorFromWorker } from './workerError'

interface Waiting {
  resolve: (answer: ChatAnswerDto) => void
  reject: (error: Error) => void
  onChunk: (text: string) => void
}

/** 話題語から録音の候補を引く役。main が意味検索のワーカーに委ねる。 */
export type FindCandidates = (params: {
  topic: string
  limit: number
}) => Promise<readonly string[]>

/**
 * チャットのワーカーとのやり取りを担う。
 *
 * SearchClient と同じく、使われている間は生かしてモデルを温めておき、
 * しばらく使われなければ終わらせて OS にメモリを返す。ただし抱える量が違う
 * （5GB 級の LLM）ので、待つ時間は短くする。
 *
 * 生成は 1 件ずつ。新しい問いが来たら前の問いを中断する。利用者が打ち直したのに
 * 前の答えが後から流れてくると、どちらの答えを読んでいるのか分からなくなる。
 */
export class ChatClient {
  private worker: PipelineWorker | undefined
  private readonly pending = new Map<string, Waiting>()
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private releaseRequested = false
  private findCandidates: FindCandidates | undefined
  private readonly idleMs: number

  constructor(
    private readonly fork: () => PipelineWorker = forkChatWorker,
    options: { idleMs?: number } = {}
  ) {
    // 2 分。続けて問い直す間は温めておくが、5GB を抱えたまま長く待たない。
    this.idleMs = options.idleMs ?? 120_000
  }

  /** 話題語での絞り込みを解決する相手を登録する。登録が無ければ絞り込みは効かない。 */
  onFindCandidates(handler: FindCandidates): void {
    this.findCandidates = handler
  }

  /** 生成中か。索引の同期など、重い処理を始めてよいかの判断に使う。 */
  isBusy(): boolean {
    return this.pending.size > 0
  }

  ask(params: {
    question: string
    history: readonly ChatTurn[]
    onChunk: (text: string) => void
  }): Promise<ChatAnswerDto> {
    // 打ち直されたら前の生成は要らない。2 本を同時に走らせてモデルを奪い合わせない。
    for (const id of this.pending.keys()) this.cancel(id)

    const worker = this.ensureWorker()
    this.clearIdleTimer()
    const id = randomUUID()

    return new Promise<ChatAnswerDto>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onChunk: params.onChunk })
      worker.postMessage({
        type: 'ask',
        id,
        question: params.question,
        history: params.history
      } satisfies ChatWorkerRequest)
    })
  }

  /** 中断のためだけにワーカーを起こしてモデルを読ませることはしない。 */
  cancel(requestId: string): void {
    if (!this.worker) return
    this.worker.postMessage({ type: 'cancel', id: requestId } satisfies ChatWorkerRequest)
  }

  /**
   * 抱えている問いが片付き次第、ワーカーを終わらせる。
   * 録音やパイプラインが始まる前に、モデルの分のメモリを空けるため。
   * 生成中の回答は打ち切らない — 数秒で終わるうえ、利用者が画面で待っている。
   */
  releaseWhenIdle(): void {
    if (!this.worker) return
    if (this.pending.size === 0) {
      this.terminate()
      return
    }
    this.releaseRequested = true
  }

  /** ワーカーを止め、終わるまで待つ。モデルを差し替える前に呼ぶ。 */
  shutdown(): Promise<void> {
    const worker = this.worker
    if (!worker) return Promise.resolve()
    const exited = new Promise<void>((resolve) => worker.on('exit', () => resolve()))
    this.terminate()
    return exited
  }

  private ensureWorker(): PipelineWorker {
    if (this.worker) return this.worker

    const worker = this.fork()
    this.releaseRequested = false

    worker.on('message', (message: unknown) => {
      if (!isChatWorkerResponse(message)) return

      if (message.type === 'find-candidates') {
        void this.resolveCandidates(worker, message.id, message.topic, message.limit)
        return
      }

      const waiting = this.pending.get(message.id)
      if (!waiting) return

      switch (message.type) {
        case 'chat-chunk':
          waiting.onChunk(message.text)
          return
        case 'chat-done':
          waiting.resolve(message.answer)
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
      // 現役のワーカーが落ちた場合だけ。
      if (this.worker !== worker) return
      this.worker = undefined
      this.clearIdleTimer()
      this.rejectPending()
    })

    this.worker = worker
    return worker
  }

  private async resolveCandidates(
    worker: PipelineWorker,
    id: string,
    topic: string,
    limit: number
  ): Promise<void> {
    let recordingIds: readonly string[] = []
    try {
      recordingIds = (await this.findCandidates?.({ topic, limit })) ?? []
    } catch {
      // 検索が使えないことを理由に会話を止めない。期間だけで絞って続けさせる。
      recordingIds = []
    }
    // 待っている間にワーカーが入れ替わっていたら、答えを返す先が無い。
    if (this.worker !== worker) return
    worker.postMessage({ type: 'candidates', id, recordingIds } satisfies ChatWorkerRequest)
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
      waiting.reject(new Error(text().error.chatExited))
    }
    this.pending.clear()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }
}

const forkChatWorker = (): PipelineWorker =>
  utilityProcess.fork(join(__dirname, 'chat-worker.js'), [], {
    // ワーカーは electron API を持たないため、必要なパスは環境変数で渡す。
    env: { ...process.env, OMR_USER_DATA: app.getPath('userData') },
    stdio: 'inherit'
  })
