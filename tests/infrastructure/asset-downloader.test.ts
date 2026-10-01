import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssetDownloader, type FetchLike } from '@infrastructure/download/AssetDownloader'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/** 指定した本文を返す最小のレスポンス。Range 要求は記録して呼び出し側で検証する。 */
const respondWith = (
  body: string,
  options: { status?: number; totalBytes?: number; seen?: (init?: RequestInit) => void } = {}
): FetchLike => {
  return async (_url, init) => {
    options.seen?.(init)
    const bytes = Buffer.from(body, 'utf8')

    return {
      ok: (options.status ?? 200) < 400,
      status: options.status ?? 200,
      statusText: 'OK',
      headers: new Headers({
        'content-length': String(options.totalBytes ?? bytes.length)
      }),
      body: streamOf(bytes)
    }
  }
}

const streamOf = (bytes: Buffer): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      // 分割して流し、進捗が段階的に届くことを確認できるようにする。
      const half = Math.ceil(bytes.length / 2)
      if (bytes.length > 0) controller.enqueue(bytes.subarray(0, half))
      if (bytes.length > half) controller.enqueue(bytes.subarray(half))
      controller.close()
    }
  })

let dir: string
let dest: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omr-dl-'))
  dest = join(dir, 'nested', 'model.bin')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('AssetDownloader', () => {
  it('ダウンロードして指定パスへ保存する', async () => {
    const downloader = new AssetDownloader(respondWith('model-body'))

    await downloader.download({ url: 'https://example.test/m.bin', destPath: dest })

    expect(await readFile(dest, 'utf8')).toBe('model-body')
  })

  it('受信バイト数と総バイト数を進捗として通知する', async () => {
    const downloader = new AssetDownloader(respondWith('0123456789'))
    const progress: { receivedBytes: number; totalBytes?: number }[] = []

    await downloader.download({
      url: 'https://example.test/m.bin',
      destPath: dest,
      onProgress: (event) => progress.push({ ...event })
    })

    expect(progress.at(-1)).toEqual({ receivedBytes: 10, totalBytes: 10 })
    expect(progress.length).toBeGreaterThan(1)
  })

  it('完了するまで最終ファイルを作らない（中断で壊れた成果物を残さない）', async () => {
    let delivered = false
    const failing: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-length': '10' }),
      // controller.error() は待ち行列を破棄するため、1 回目の pull で
      // チャンクを渡し、2 回目で失敗させて「受信済みだが途中で切れた」を再現する。
      body: new ReadableStream({
        pull(controller) {
          if (delivered) {
            controller.error(new Error('接続が切れました'))
            return
          }
          delivered = true
          controller.enqueue(Buffer.from('012'))
        }
      })
    })

    await expect(
      new AssetDownloader(failing).download({ url: 'https://example.test/m.bin', destPath: dest })
    ).rejects.toThrow()

    await expect(stat(dest)).rejects.toThrow()
    // 途中まで受け取った内容は再開用に残す
    expect(await readFile(`${dest}.part`, 'utf8')).toBe('012')
  })

  it('途中まで残っていれば Range 要求で再開する', async () => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(`${dest}.part`, '012', 'utf8')

    let requestedRange: string | undefined
    const downloader = new AssetDownloader(
      respondWith('3456789', {
        status: 206,
        totalBytes: 7,
        seen: (init) => {
          requestedRange = new Headers(init?.headers).get('range') ?? undefined
        }
      })
    )

    await downloader.download({ url: 'https://example.test/m.bin', destPath: dest })

    expect(requestedRange).toBe('bytes=3-')
    expect(await readFile(dest, 'utf8')).toBe('0123456789')
  })

  it('サーバーが範囲要求を無視したら最初から取り直す', async () => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(`${dest}.part`, 'ゴミ', 'utf8')

    // 200 を返す＝全体を送ってきている
    const downloader = new AssetDownloader(respondWith('0123456789', { status: 200 }))

    await downloader.download({ url: 'https://example.test/m.bin', destPath: dest })

    expect(await readFile(dest, 'utf8')).toBe('0123456789')
  })

  it('チェックサムが一致すれば保存する', async () => {
    const downloader = new AssetDownloader(respondWith('model-body'))

    await downloader.download({
      url: 'https://example.test/m.bin',
      destPath: dest,
      sha256: sha256('model-body')
    })

    expect(await readFile(dest, 'utf8')).toBe('model-body')
  })

  it('チェックサムが違えば保存せず、壊れた途中ファイルも捨てる', async () => {
    const downloader = new AssetDownloader(respondWith('tampered'))

    await expect(
      downloader.download({
        url: 'https://example.test/m.bin',
        destPath: dest,
        sha256: sha256('model-body')
      })
    ).rejects.toThrow('downloadCorrupted')

    await expect(stat(dest)).rejects.toThrow()
    // 壊れた再開用ファイルを残すと次回も失敗し続けるため消す
    await expect(stat(`${dest}.part`)).rejects.toThrow()
  })

  it('すでに保存済みならダウンロードしない', async () => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(dest, 'already-there', 'utf8')

    let called = false
    const downloader = new AssetDownloader(async () => {
      called = true
      throw new Error('呼ばれてはいけない')
    })

    await downloader.download({ url: 'https://example.test/m.bin', destPath: dest })

    expect(called).toBe(false)
    expect(await readFile(dest, 'utf8')).toBe('already-there')
  })

  it('HTTP エラーは利用者向けメッセージにする', async () => {
    const downloader = new AssetDownloader(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
      body: null
    }))

    await expect(downloader.download({ url: 'https://example.test/m.bin', destPath: dest })).rejects.toThrow(
      'downloadHttp'
    )
  })

  it('中断されたら途中ファイルを残して再開できるようにする', async () => {
    const controller = new AbortController()
    const downloader = new AssetDownloader(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-length': '100' }),
      body: new ReadableStream({
        start(streamController) {
          streamController.enqueue(Buffer.from('01234'))
          controller.abort()
          streamController.close()
        }
      })
    }))

    await expect(
      downloader.download({
        url: 'https://example.test/m.bin',
        destPath: dest,
        signal: controller.signal
      })
    ).rejects.toThrow('downloadAborted')

    expect(await readFile(`${dest}.part`, 'utf8')).toBe('01234')
  })
})
