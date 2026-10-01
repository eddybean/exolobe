import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findAsset, type ManagedAsset } from '@domain/ModelCatalog'
import { AssetDownloader, type FetchLike } from '@infrastructure/download/AssetDownloader'
import { FileModelStore, extractCommand } from '@infrastructure/download/FileModelStore'
import { notMacOS } from '../platform'

let modelsDir: string
let store: FileModelStore

const asset = (id: string): ManagedAsset => {
  const found = findAsset(id)
  if (!found) throw new Error(`テストの前提が壊れています: ${id}`)
  return found
}

beforeEach(async () => {
  modelsDir = await mkdtemp(join(tmpdir(), 'omr-models-'))
  store = new FileModelStore(modelsDir)
})

afterEach(async () => {
  await rm(modelsDir, { recursive: true, force: true })
})

describe('FileModelStore.remove', () => {
  it('管理下のファイルを消す', async () => {
    const target = asset('transcription-model')
    const path = store.pathFor(target)
    await writeFile(path, 'dummy')

    await store.remove(target)

    expect(await store.exists(path)).toBe(false)
  })

  it('ファイルが無くても失敗しない', async () => {
    await expect(store.remove(asset('summarization-model'))).resolves.toBeUndefined()
  })

  it('アーカイブのモデルは展開したディレクトリごと消す', async () => {
    const target = asset('diarization-segmentation')
    const path = store.pathFor(target)
    await mkdir(join(modelsDir, 'sherpa-onnx-pyannote-segmentation-3-0'), { recursive: true })
    await writeFile(path, 'dummy')
    // 展開時に一緒に出てくる付随ファイルも残さない。
    await writeFile(join(modelsDir, 'sherpa-onnx-pyannote-segmentation-3-0', 'LICENSE'), 'x')

    await store.remove(target)

    expect(await store.exists(path)).toBe(false)
    expect(await store.exists(join(modelsDir, 'sherpa-onnx-pyannote-segmentation-3-0', 'LICENSE'))).toBe(false)
  })

  it('中断で残った途中までのアーカイブも消す', async () => {
    const target = asset('diarization-segmentation')
    const archive = join(modelsDir, target.fileName)
    await writeFile(archive, 'partial')

    await store.remove(target)

    expect(await store.exists(archive)).toBe(false)
  })
})

/** テスト用の擬似アーカイブは配布物と中身が違うので、チェックサムだけ外す。 */
const unverified = ({ sha256: _ignored, ...rest }: ManagedAsset): ManagedAsset => rest

describe.skipIf(notMacOS)('FileModelStore.fetch（zip アーカイブ）', () => {
  /** ditto で固めた zip を返す fetch。Core ML エンコーダの配布形と同じ形にする。 */
  const zipOf = async (dir: string): Promise<FetchLike> => {
    const src = join(dir, 'src')
    await mkdir(join(src, 'ggml-large-v3-turbo-encoder.mlmodelc', 'weights'), { recursive: true })
    await writeFile(join(src, 'ggml-large-v3-turbo-encoder.mlmodelc', 'weights', 'weight.bin'), 'w')
    await writeFile(join(src, 'ggml-large-v3-turbo-encoder.mlmodelc', 'model.mil'), 'm')

    const archive = join(dir, 'src.zip')
    // --sequesterRsrc は Hugging Face の配布物と同じく __MACOSX を作る。
    await promisify(execFile)('/usr/bin/ditto', [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      join(src, 'ggml-large-v3-turbo-encoder.mlmodelc'),
      archive
    ])
    const bytes = await readFile(archive)

    return async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-length': String(bytes.length) }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        }
      })
    })
  }

  it('zip を展開し、__MACOSX を残さない', async () => {
    const work = await mkdtemp(join(tmpdir(), 'omr-zip-'))
    try {
      const target = unverified(asset('transcription-coreml-encoder'))
      const store = new FileModelStore(modelsDir, new AssetDownloader(await zipOf(work)))

      const path = await store.fetch(target, {})

      expect(path).toBe(store.pathFor(target))
      expect(await store.exists(path)).toBe(true)
      // AppleDouble の残骸を models ディレクトリに残さない。
      expect(existsSync(join(modelsDir, '__MACOSX'))).toBe(false)
      // 展開後のアーカイブ本体も片付ける。
      expect(existsSync(join(modelsDir, target.fileName))).toBe(false)
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  })

  it('展開したディレクトリごと消せる', async () => {
    const work = await mkdtemp(join(tmpdir(), 'omr-zip-'))
    try {
      const target = unverified(asset('transcription-coreml-encoder'))
      const store = new FileModelStore(modelsDir, new AssetDownloader(await zipOf(work)))
      await store.fetch(target, {})

      await store.remove(target)

      expect(existsSync(join(modelsDir, 'ggml-large-v3-turbo-encoder.mlmodelc'))).toBe(false)
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  })
})

describe('extractCommand', () => {
  it('macOS は zip を ditto、tar.bz2 を tar で展開する', () => {
    expect(extractCommand('zip', '/m/a.zip', '/m', 'darwin')).toEqual({
      command: '/usr/bin/ditto',
      args: ['-x', '-k', '/m/a.zip', '/m']
    })
    expect(extractCommand('tar.bz2', '/m/a.tar.bz2', '/m', 'darwin')).toEqual({
      command: '/usr/bin/tar',
      args: ['-xjf', '/m/a.tar.bz2', '-C', '/m']
    })
  })

  it('Windows は OS 付属の tar.exe（bsdtar）で展開する（PATH 上の Git の GNU tar は bz2 や zip を読めないことがある）', () => {
    expect(extractCommand('tar.bz2', 'C:\\m\\a.tar.bz2', 'C:\\m', 'win32', 'C:\\Windows')).toEqual({
      command: 'C:\\Windows\\System32\\tar.exe',
      args: ['-xf', 'C:\\m\\a.tar.bz2', '-C', 'C:\\m']
    })
  })
})

/** sherpa-onnx-pyannote-segmentation-3-0/model.onnx（中身は "m"）だけを入れた tar.bz2。 */
const TINY_TAR_BZ2 = Buffer.from(
  'QlpoOTFBWSZTWQaHekEAAJt5kPGAAYBAA/+Qf+feYAQAAAgwANakYAZNNBkMENMRowJRT1T9NU2oaaAyabUAABVRqRHppoTEwGieo9DCn6hifLNO2whDrWiIDu4jKeTIMCKIoZxxTfKKPt9TjiuWNi1dW16YHNMKjmnKO8IJpHFrRUKGDjEiUyZAxltKVxUKaxYiai1CmdmRKqXpe5MUGdxX0MHuxatWOz2+VKjLBdWpJy1PhOVeK/uzN6FLFSoX6sGTaVNapkZOBgB/F3JFOFCQBod6QQ==',
  'base64'
)

// OS のコマンドで実際に展開する。Windows の CI では tar.exe が bz2 を読めることの確認を兼ねる。
describe('FileModelStore.fetch（tar.bz2 アーカイブ）', () => {
  it('展開して、中のモデルを指す', async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-length': String(TINY_TAR_BZ2.length) }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(TINY_TAR_BZ2))
          controller.close()
        }
      })
    })
    const target = unverified(asset('diarization-segmentation'))
    const store = new FileModelStore(modelsDir, new AssetDownloader(fetch))

    const path = await store.fetch(target, {})

    expect(await readFile(path, 'utf8')).toBe('m')
    expect(existsSync(join(modelsDir, target.fileName))).toBe(false)
  })
})

describe('FileModelStore（配布物の版）', () => {
  const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

  /** 渡した本文を返す fetch。呼ばれた回数も数える。 */
  const serving = (text: string | Error): FetchLike & { calls: number } => {
    const fake = Object.assign(
      async () => {
        fake.calls += 1
        if (text instanceof Error) throw text
        const bytes = new TextEncoder().encode(text)
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-length': String(bytes.length) }),
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes)
              controller.close()
            }
          })
        }
      },
      { calls: 0 }
    )
    return fake
  }

  /** 中身の sha256 と保存名だけを差し替えた、単一ファイルのモデル。 */
  const release = (content: string, fileName = 'model.gguf'): ManagedAsset => ({
    ...asset('summarization-model'),
    fileName,
    sha256: sha256(content)
  })

  it('取得したファイルは配布物の sha256 を返す', async () => {
    const target = release('v1')
    const store = new FileModelStore(modelsDir, new AssetDownloader(serving('v1')))

    const path = await store.fetch(target, {})

    expect(await store.installedDigest(target, path)).toBe(sha256('v1'))
  })

  it('記録の無い既存のファイルは中身から求め、記録に残す', async () => {
    // この仕組みより前に取得したファイルにも、次のカタログ更新で気付けるようにする。
    const target = release('v1')
    const path = store.pathFor(target)
    await writeFile(path, 'v0')

    expect(await store.installedDigest(target, path)).toBe(sha256('v0'))
    const manifest = JSON.parse(await readFile(join(modelsDir, 'installed.json'), 'utf8'))
    expect(manifest.assets['summarization-model'].sha256).toBe(sha256('v0'))
  })

  it('記録の後で書き換わったファイルは求め直す', async () => {
    const target = release('v1')
    const path = store.pathFor(target)
    await writeFile(path, 'v0')
    await store.installedDigest(target, path)

    await writeFile(path, 'v0-edited')

    expect(await store.installedDigest(target, path)).toBe(sha256('v0-edited'))
  })

  it('models ディレクトリの外のファイルは確かめない', async () => {
    // 利用者が自分で選んだファイルを古いと決めつけないため。
    const outside = await mkdtemp(join(tmpdir(), 'omr-outside-'))
    try {
      const path = join(outside, 'mine.gguf')
      await writeFile(path, 'v0')

      expect(await store.installedDigest(release('v1'), path)).toBeUndefined()
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('記録の無いアーカイブ由来のファイルは確かめようがない', async () => {
    // 展開後にアーカイブは消しているため、配布物の sha256 と比べる材料が無い。
    const target = asset('diarization-segmentation')
    const path = store.pathFor(target)
    await mkdir(join(modelsDir, 'sherpa-onnx-pyannote-segmentation-3-0'), { recursive: true })
    await writeFile(path, 'x')

    expect(await store.installedDigest(target, path)).toBeUndefined()
  })

  it('カタログと違うファイルは同じ場所で取り替える', async () => {
    const path = store.pathFor(release('v1'))
    await writeFile(path, 'v0')
    const fetchLike = serving('v1')
    const store2 = new FileModelStore(modelsDir, new AssetDownloader(fetchLike))

    expect(await store2.fetch(release('v1'), {})).toBe(path)
    expect(await readFile(path, 'utf8')).toBe('v1')
    expect(await store2.installedDigest(release('v1'), path)).toBe(sha256('v1'))
  })

  it('カタログと一致していれば取り直さない', async () => {
    const path = store.pathFor(release('v1'))
    await writeFile(path, 'v1')
    const fetchLike = serving('v1')

    await new FileModelStore(modelsDir, new AssetDownloader(fetchLike)).fetch(release('v1'), {})

    expect(fetchLike.calls).toBe(0)
  })

  it('取り替えに失敗しても古いファイルは残す', async () => {
    const path = store.pathFor(release('v1'))
    await writeFile(path, 'v0')
    const failing = new FileModelStore(modelsDir, new AssetDownloader(serving(new Error('offline'))))

    await expect(failing.fetch(release('v1'), {})).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe('v0')
  })

  it('保存名が変わったら古い名前のファイルを消す', async () => {
    const old = release('v0', 'old.gguf')
    await new FileModelStore(modelsDir, new AssetDownloader(serving('v0'))).fetch(old, {})

    const renamed = release('v1', 'new.gguf')
    await new FileModelStore(modelsDir, new AssetDownloader(serving('v1'))).fetch(renamed, {})

    expect(existsSync(join(modelsDir, 'old.gguf'))).toBe(false)
    expect(await readFile(join(modelsDir, 'new.gguf'), 'utf8')).toBe('v1')
  })

  it('削除したモデルの記録も消す', async () => {
    const target = release('v1')
    const path = await new FileModelStore(modelsDir, new AssetDownloader(serving('v1'))).fetch(target, {})

    await store.remove(target)

    const manifest = JSON.parse(await readFile(join(modelsDir, 'installed.json'), 'utf8'))
    expect(manifest.assets['summarization-model']).toBeUndefined()
    expect(existsSync(path)).toBe(false)
  })
})
