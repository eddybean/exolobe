import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findAsset, type ManagedAsset } from '@domain/ModelCatalog'
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
