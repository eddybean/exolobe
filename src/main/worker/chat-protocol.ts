import type { ChatTurn } from '@application/ports'
import type { ChatAnswerDto } from '@shared/ipc'
import type { WorkerErrorPayload } from './workerError'

/** main ↔ チャットワーカー間のメッセージ。 */

export type ChatWorkerRequest =
  | {
      readonly type: 'ask'
      readonly id: string
      readonly question: string
      readonly history: readonly ChatTurn[]
    }
  /** 生成中の回答を、途中まで書けたところで止める。 */
  | { readonly type: 'cancel'; readonly id: string }
  /** 意味検索は別プロセスに居るので、main が解決して返した候補。 */
  | { readonly type: 'candidates'; readonly id: string; readonly recordingIds: readonly string[] }

export type ChatWorkerResponse =
  | { readonly type: 'chat-chunk'; readonly id: string; readonly text: string }
  | { readonly type: 'chat-done'; readonly id: string; readonly answer: ChatAnswerDto }
  | ({ readonly type: 'error'; readonly id: string } & WorkerErrorPayload)
  /** 話題語での絞り込みを main に頼む。埋め込みモデルをこのプロセスに載せないため。 */
  | {
      readonly type: 'find-candidates'
      readonly id: string
      readonly topic: string
      readonly limit: number
    }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isTurnArray = (value: unknown): value is ChatTurn[] =>
  Array.isArray(value) &&
  value.every(
    (turn) =>
      isRecord(turn) &&
      (turn['role'] === 'user' || turn['role'] === 'assistant') &&
      typeof turn['text'] === 'string'
  )

export const isChatWorkerRequest = (value: unknown): value is ChatWorkerRequest => {
  if (!isRecord(value) || typeof value['id'] !== 'string') return false
  switch (value['type']) {
    case 'ask':
      return typeof value['question'] === 'string' && isTurnArray(value['history'])
    case 'cancel':
      return true
    case 'candidates':
      return (
        Array.isArray(value['recordingIds']) &&
        value['recordingIds'].every((id) => typeof id === 'string')
      )
    default:
      return false
  }
}

export const isChatWorkerResponse = (value: unknown): value is ChatWorkerResponse => {
  if (!isRecord(value) || typeof value['id'] !== 'string') return false
  const type = value['type']
  return (
    type === 'chat-chunk' || type === 'chat-done' || type === 'error' || type === 'find-candidates'
  )
}
