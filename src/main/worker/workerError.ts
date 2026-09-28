import { AppError, reasonOf, toMessage, type ErrorReason } from '@domain/errors'

/**
 * ワーカーから main へ送る失敗。
 *
 * ワーカーは UI の言語を知らないので文言にせず、理由をそのまま運ぶ（ADR-043）。
 * 文言は main が IPC で返すときに引く。理由の無い失敗（ネイティブ由来など）はメッセージだけ。
 */
export interface WorkerErrorPayload {
  readonly message: string
  readonly reason?: ErrorReason
}

export const errorToWorkerPayload = (error: unknown): WorkerErrorPayload => {
  const reason = reasonOf(error)
  return reason ? { message: toMessage(error), reason } : { message: toMessage(error) }
}

export const errorFromWorker = (payload: WorkerErrorPayload): Error =>
  payload.reason ? new AppError(payload.reason) : new Error(payload.message)
