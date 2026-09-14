import type { PipelineStep } from '@domain/Recording'
import type { ProgressEventDto, RecordingDto } from '@shared/ipc'

/** main ↔ パイプラインワーカー間のメッセージ。 */

export interface RunPipelineRequest {
  readonly type: 'run'
  readonly jobId: string
  readonly recordingId: string
  readonly only?: readonly PipelineStep[]
}

/**
 * 完了済みの録音から声紋を取り直す依頼。
 *
 * パイプラインと同じワーカーに乗せる。埋め込みモデルはネイティブで、1 ジョブごとに
 * プロセスを終わらせて確実にメモリを返す作法をそのまま使いたい（ADR-008）。
 */
export interface ExtractVoicesRequest {
  readonly type: 'voices'
  readonly jobId: string
  readonly recordingId: string
}

export type WorkerRequest = RunPipelineRequest | ExtractVoicesRequest

export type WorkerResponse =
  | { readonly type: 'progress'; readonly event: ProgressEventDto }
  | { readonly type: 'done'; readonly jobId: string; readonly recording: RecordingDto }
  /** 声紋の取り直しの完了。取れた声紋は録音と一緒に保存済みなので、返すものは無い。 */
  | { readonly type: 'voices-done'; readonly jobId: string }
  | { readonly type: 'error'; readonly jobId: string; readonly message: string }

export const isWorkerRequest = (value: unknown): value is WorkerRequest => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<WorkerRequest>
  return (
    (candidate.type === 'run' || candidate.type === 'voices') &&
    typeof candidate.jobId === 'string' &&
    typeof candidate.recordingId === 'string'
  )
}

export const isWorkerResponse = (value: unknown): value is WorkerResponse => {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return type === 'progress' || type === 'done' || type === 'voices-done' || type === 'error'
}
