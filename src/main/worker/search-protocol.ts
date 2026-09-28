import type { SyncSearchIndexResult } from '@application/usecases/search'
import type { SearchHitDto } from '@shared/ipc'
import type { WorkerErrorPayload } from './workerError'

/** main ↔ 検索ワーカー間のメッセージ。 */

export type SearchWorkerRequest =
  | { readonly type: 'search'; readonly id: string; readonly query: string; readonly limit: number }
  | { readonly type: 'sync'; readonly id: string }
  /** 進行中の同期を、今の録音を終えたところで止める。 */
  | { readonly type: 'cancel-sync' }

export type SearchWorkerResponse =
  | { readonly type: 'search-result'; readonly id: string; readonly hits: SearchHitDto[] }
  | {
      readonly type: 'sync-progress'
      readonly id: string
      readonly done: number
      readonly total: number
    }
  | { readonly type: 'sync-done'; readonly id: string; readonly result: SyncSearchIndexResult }
  | ({ readonly type: 'error'; readonly id: string } & WorkerErrorPayload)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const isSearchWorkerRequest = (value: unknown): value is SearchWorkerRequest => {
  if (!isRecord(value)) return false
  switch (value['type']) {
    case 'search':
      return (
        typeof value['id'] === 'string' &&
        typeof value['query'] === 'string' &&
        typeof value['limit'] === 'number'
      )
    case 'sync':
      return typeof value['id'] === 'string'
    case 'cancel-sync':
      return true
    default:
      return false
  }
}

export const isSearchWorkerResponse = (value: unknown): value is SearchWorkerResponse => {
  if (!isRecord(value) || typeof value['id'] !== 'string') return false
  const type = value['type']
  return (
    type === 'search-result' || type === 'sync-progress' || type === 'sync-done' || type === 'error'
  )
}
