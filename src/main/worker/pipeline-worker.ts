import { toMessage } from '@domain/errors'
import { toRecordingDto } from '@shared/ipc'
import { createPipeline, createVoiceExtractor } from './pipeline-container'
import { isWorkerRequest, type WorkerResponse } from './protocol'

/**
 * 文字起こし・要約・話者識別を担当する utilityProcess。
 *
 * これらは llama.cpp や sherpa-onnx のネイティブコードを動かし、数 GB の
 * メモリを使う。main プロセスで動かすとネイティブ側のクラッシュがウィンドウごと
 * アプリを落とすため、別プロセスに隔離する。落ちても main は生き残り、
 * 録音済みのファイルと状態は残る。
 *
 * ジョブは 1 件ずつ直列に処理する。whisper と LLM を同時に載せると 16GB では
 * メモリが足りなくなるため。
 */
const port = process.parentPort

const send = (response: WorkerResponse): void => {
  port.postMessage(response)
}

let queue: Promise<void> = Promise.resolve()

port.on('message', (message) => {
  const request: unknown = message.data
  if (!isWorkerRequest(request)) return

  // 直前のジョブが終わってから始める。
  queue = queue.then(async () => {
    try {
      const userData = process.env['OMR_USER_DATA'] ?? ''

      // 声紋の取り直しはパイプラインの外側の仕事だが、読むモデルもクラッシュの
      // 危うさも同じなので同じワーカーで捌く。
      if (request.type === 'voices') {
        const extractor = await createVoiceExtractor(userData)
        await extractor.execute(request.recordingId)
        send({ type: 'voices-done', jobId: request.jobId })
        return
      }

      const pipeline = await createPipeline(userData, {
        report: (event) => send({ type: 'progress', event })
      })

      const recording = await pipeline.execute({
        recordingId: request.recordingId,
        ...(request.only === undefined ? {} : { only: request.only })
      })

      send({ type: 'done', jobId: request.jobId, recording: toRecordingDto(recording) })
    } catch (error: unknown) {
      send({ type: 'error', jobId: request.jobId, message: toMessage(error) })
    }
  })
})
