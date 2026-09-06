import type { PipelineStep } from '@domain/Recording'
import type { ProgressEventDto, RecordingDto } from '@shared/ipc'

/** main ↔ パイプラインワーカー間のメッセージ。 */

export interface RunPipelineRequest {
  readonly type: 'run'
  readonly jobId: string
  readonly recordingId: string
  readonly only?: readonly PipelineStep[]
}

export type WorkerRequest = RunPipelineRequest

export type WorkerResponse =
  | { readonly type: 'progress'; readonly event: ProgressEventDto }
  | { readonly type: 'done'; readonly jobId: string; readonly recording: RecordingDto }
  | { readonly type: 'error'; readonly jobId: string; readonly message: string }

export const isWorkerRequest = (value: unknown): value is WorkerRequest => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<RunPipelineRequest>
  return (
    candidate.type === 'run' &&
    typeof candidate.jobId === 'string' &&
    typeof candidate.recordingId === 'string'
  )
}

export const isWorkerResponse = (value: unknown): value is WorkerResponse => {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return type === 'progress' || type === 'done' || type === 'error'
}
