import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findAsset, type ManagedAsset } from '@domain/ModelCatalog'
import { AssetDownloader, type FetchLike } from '@infrastructure/download/AssetDownloader'
import { FileModelStore } from '@infrastructure/download/FileModelStore'

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
    expect(
      await store.exists(join(modelsDir, 'sherpa-onnx-pyannote-segmentation-3-0', 'LICENSE'))
    ).toBe(false)
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

describe('FileModelStore.fetch（zip アーカイブ）', () => {
  /** ditto で固めた zip を返す fetch。Core ML エンコーダの配布形と同じ形にする。 */
  const zipOf = async (dir: string): Promise<FetchLike> => {
    const src = join(dir, 'src')
    await mkdir(join(src, 'ggml-large-v3-turbo-encoder.mlmodelc', 'weights'), { recursive: true })
    await writeFile(
      join(src, 'ggml-large-v3-turbo-encoder.mlmodelc', 'weights', 'weight.bin'),
      'w'
    )
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
