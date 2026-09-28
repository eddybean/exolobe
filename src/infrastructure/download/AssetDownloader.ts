import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AppError, toMessage } from '@domain/errors'

export class DownloadError extends AppError {}

export interface DownloadProgress {
  readonly receivedBytes: number
  /** サーバーが長さを返さない場合は undefined。 */
  readonly totalBytes?: number
}

/** テストで差し替えられるよう、必要な部分だけを写した fetch の型。 */
export type FetchLike = (
  url: string,
  init?: RequestInit
) => Promise<{
  ok: boolean
  status: number
  statusText: string
  headers: Headers
  body: ReadableStream<Uint8Array> | null
}>

/**
 * モデルなどの大きなファイルをダウンロードする。
 *
 * 数 GB のファイルを扱うため、次の 3 点を守る:
 * - 完成するまで最終パスに置かない。中断で壊れたモデルを掴ませない。
 * - 途中まで受け取った分は `.part` に残し、Range 要求で再開する。
 *   回線が不安定な環境で 5GB を最初からやり直させない。
 * - チェックサムが与えられていれば検証する。壊れたモデルは読み込み時に
 *   分かりにくいエラーになるため、入口で弾く。
 */
export class AssetDownloader {
  constructor(private readonly fetchImpl: FetchLike = globalThis.fetch) {}

  async download(params: {
    url: string
    destPath: string
    sha256?: string
    signal?: AbortSignal
    onProgress?: (progress: DownloadProgress) => void
  }): Promise<void> {
    if (await exists(params.destPath)) return

    await mkdir(dirname(params.destPath), { recursive: true })
    const partPath = `${params.destPath}.part`
    const resumeFrom = await sizeOf(partPath)

    const response = await this.request(params.url, resumeFrom, params.signal)

    // 206 以外が返ってきたらサーバーは範囲要求を無視している。最初から書き直す。
    const resumed = response.status === 206 && resumeFrom > 0
    const handle = await open(partPath, resumed ? 'r+' : 'w')

    let receivedBytes = resumed ? resumeFrom : 0
    const totalBytes = totalBytesOf(response.headers, resumed ? resumeFrom : 0)

    try {
      if (!response.body) {
        throw new DownloadError({ code: 'downloadEmpty' })
      }

      // ReadableStream の非同期イテレーションは型定義に無いため reader を直接使う。
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        // 受け取った分は必ず書いてから中断を判定する。先に捨てると再開の
        // たびに同じ範囲を取り直すことになり、再開の意味が薄れる。
        const buffer = Buffer.from(value)
        await handle.write(buffer, 0, buffer.length, receivedBytes)
        receivedBytes += buffer.length
        params.onProgress?.({
          receivedBytes,
          ...(totalBytes === undefined ? {} : { totalBytes })
        })

        if (params.signal?.aborted) {
          await reader.cancel()
          throw new DownloadError({ code: 'downloadAborted' })
        }
      }
    } catch (error: unknown) {
      // 途中までの内容は再開に使えるので残す。
      throw error instanceof DownloadError
        ? error
        : new DownloadError(
            { code: 'downloadFailed', detail: toMessage(error) },
            { cause: error }
          )
    } finally {
      await handle.close()
    }

    if (params.sha256) {
      const actual = await hashOf(partPath)
      if (actual !== params.sha256.toLowerCase()) {
        // 壊れたまま残すと再開のたびに同じ失敗を繰り返すため捨てる。
        await rm(partPath, { force: true })
        throw new DownloadError({ code: 'downloadCorrupted' })
      }
    }

    await rename(partPath, params.destPath)
  }

  private async request(
    url: string,
    resumeFrom: number,
    signal?: AbortSignal
  ): ReturnType<FetchLike> {
    const init: RequestInit = {
      ...(signal === undefined ? {} : { signal }),
      ...(resumeFrom > 0 ? { headers: { range: `bytes=${resumeFrom}-` } } : {})
    }

    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await this.fetchImpl(url, init)
    } catch (error: unknown) {
      throw new DownloadError(
        { code: 'downloadNetwork', detail: toMessage(error) },
        { cause: error }
      )
    }

    if (!response.ok) {
      throw new DownloadError({
        code: 'downloadHttp',
        status: response.status,
        statusText: response.statusText
      })
    }

    return response
  }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const sizeOf = async (path: string): Promise<number> => {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/** 再開時の Content-Length は残りの長さなので、既に持っている分を足す。 */
const totalBytesOf = (headers: Headers, alreadyHave: number): number | undefined => {
  const raw = headers.get('content-length')
  if (raw === null) return undefined

  const length = Number(raw)
  return Number.isFinite(length) ? length + alreadyHave : undefined
}

/** 数 GB のモデルでもメモリに載せないよう、ストリームで読む。 */
export const hashOf = async (path: string): Promise<string> => {
  const handle = await open(path, 'r')
  try {
    const hash = createHash('sha256')
    for await (const chunk of handle.createReadStream()) {
      hash.update(chunk)
    }
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}
