import type { SearchHit } from '@application/usecases/search'
import { errorToWorkerPayload } from './workerError'
import type { SearchHitDto } from '@shared/ipc'
import { createSearch, type SearchServices } from './search-container'
import { isSearchWorkerRequest, type SearchWorkerResponse } from './search-protocol'
import { UI_LOCALE_ENV, parseLocale } from '@shared/i18n/locale'

/**
 * 意味検索の utilityProcess。
 *
 * 埋め込みモデル（llama.cpp のネイティブコード）を main から隔離する。落ちても
 * main は生き残り、次の依頼で作り直される。
 *
 * パイプラインのワーカーと違って依頼を並行して受ける。同期の最中でも検索に
 * 答えられるようにするため。モデルへの入力は node-llama-cpp が 1 本ずつに
 * 直列化し、同期は 1 チャンクずつ待つので、検索はチャンク 1 つ分しか待たない。
 */
const port = process.parentPort

const send = (response: SearchWorkerResponse): void => {
  port.postMessage(response)
}

let services: Promise<SearchServices> | undefined

const getServices = (): Promise<SearchServices> => {
  services ??= createSearch(process.env['OMR_USER_DATA'] ?? '', parseLocale(process.env[UI_LOCALE_ENV])).catch(
    (error: unknown) => {
      services = undefined
      throw error
    }
  )
  return services
}

let syncAbort: AbortController | undefined

const toDto = (hit: SearchHit): SearchHitDto => ({
  recordingId: hit.recordingId,
  title: hit.title,
  startedAt: hit.startedAt.toISOString(),
  score: hit.score,
  source: hit.source,
  excerpt: hit.excerpt,
  ...(hit.startMs === undefined ? {} : { startMs: hit.startMs })
})

port.on('message', (message) => {
  const request: unknown = message.data
  if (!isSearchWorkerRequest(request)) return

  switch (request.type) {
    case 'cancel-sync':
      syncAbort?.abort()
      return

    case 'search':
      void (async () => {
        try {
          const { search } = await getServices()
          const hits = await search.execute({ query: request.query, limit: request.limit })
          send({ type: 'search-result', id: request.id, hits: hits.map(toDto) })
        } catch (error: unknown) {
          send({ type: 'error', id: request.id, ...errorToWorkerPayload(error) })
        }
      })()
      return

    case 'sync':
      void (async () => {
        const controller = new AbortController()
        syncAbort = controller
        try {
          const { sync } = await getServices()
          const result = await sync.execute({
            signal: controller.signal,
            onProgress: (done, total) => send({ type: 'sync-progress', id: request.id, done, total })
          })
          send({ type: 'sync-done', id: request.id, result })
        } catch (error: unknown) {
          send({ type: 'error', id: request.id, ...errorToWorkerPayload(error) })
        } finally {
          if (syncAbort === controller) syncAbort = undefined
        }
      })()
      return
  }
})
