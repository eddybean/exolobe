import type { RecordingFinderPort } from '@application/ports'
import type { ChatAnswer } from '@application/usecases/chat'
import { toMessage } from '@domain/errors'
import type { ChatAnswerDto } from '@shared/ipc'
import { createChat, type ChatServices } from './chat-container'
import { isChatWorkerRequest, type ChatWorkerResponse } from './chat-protocol'

/**
 * チャットの utilityProcess。
 *
 * 5GB 級のモデル（llama.cpp のネイティブコード）を main から隔離する。落ちても
 * main は生き残り、次の問いで作り直される。
 *
 * 生成は 1 件ずつ。同じモデルに 2 本流し込むと、どちらも遅くなるうえ
 * KV キャッシュを奪い合う。新しい問いが来たら前の問いを中断する。
 */
const port = process.parentPort

const send = (response: ChatWorkerResponse): void => {
  port.postMessage(response)
}

/** 候補の問い合わせの待ち合わせ。id ごとに main からの答えを待つ。 */
const candidateWaiters = new Map<string, (recordingIds: readonly string[]) => void>()

/**
 * 話題語での絞り込みを main に委ねる窓。
 *
 * 埋め込みモデルはこのプロセスに載せられないので、解決は意味検索のワーカーに任せる。
 * parentPort は electron API ではないため、ワーカーの制約には触れない。
 */
const finderFor = (requestId: string): RecordingFinderPort => ({
  find: (params) =>
    new Promise<readonly string[]>((resolve) => {
      candidateWaiters.set(requestId, resolve)
      send({ type: 'find-candidates', id: requestId, topic: params.topic, limit: params.limit })
    })
})

let services: Promise<ChatServices> | undefined

const getServices = (finder: RecordingFinderPort): Promise<ChatServices> => {
  services ??= createChat(process.env['OMR_USER_DATA'] ?? '', finder).catch((error: unknown) => {
    services = undefined
    throw error
  })
  return services
}

const aborts = new Map<string, AbortController>()

const toDto = (answer: ChatAnswer): ChatAnswerDto => ({
  text: answer.text,
  citations: answer.citations.map((citation) => ({
    recordingId: citation.recordingId,
    title: citation.title,
    startedAt: citation.startedAt.toISOString(),
    source: citation.source,
    ...(citation.startMs === undefined ? {} : { startMs: citation.startMs }),
    truncated: citation.truncated
  })),
  ...(answer.scopeLabel === undefined ? {} : { scopeLabel: answer.scopeLabel }),
  usedTranscript: answer.usedTranscript,
  droppedCount: answer.droppedCount,
  truncated: answer.truncated
})

port.on('message', (message) => {
  const request: unknown = message.data
  if (!isChatWorkerRequest(request)) return

  switch (request.type) {
    case 'cancel':
      aborts.get(request.id)?.abort()
      return

    case 'candidates': {
      const waiter = candidateWaiters.get(request.id)
      candidateWaiters.delete(request.id)
      waiter?.(request.recordingIds)
      return
    }

    case 'ask':
      void (async () => {
        const controller = new AbortController()
        aborts.set(request.id, controller)
        try {
          const { ask } = await getServices(finderFor(request.id))
          const answer = await ask.execute({
            question: request.question,
            history: request.history,
            onChunk: (text) => send({ type: 'chat-chunk', id: request.id, text }),
            signal: controller.signal
          })
          send({ type: 'chat-done', id: request.id, answer: toDto(answer) })
        } catch (error: unknown) {
          send({ type: 'error', id: request.id, message: toMessage(error) })
        } finally {
          aborts.delete(request.id)
          candidateWaiters.delete(request.id)
        }
      })()
      return
  }
})

process.on('exit', () => {
  void services?.then((current) => current.dispose()).catch(() => undefined)
})
