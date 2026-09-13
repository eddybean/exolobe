import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FileVoiceprintRepository,
  type StorageLocator
} from '@infrastructure/persistence/FileVoiceprintStore'
import type { Voiceprint } from '@domain/Voiceprint'

let storage: string
let locator: StorageLocator
let repository: FileVoiceprintRepository

const print = (name: string, vector: number[]): Voiceprint => ({
  name,
  vector: Float32Array.from(vector),
  samples: 1,
  modelKey: 'campplus:192',
  updatedAt: '2026-09-13T12:00:00.000Z'
})

beforeEach(async () => {
  storage = await mkdtemp(join(tmpdir(), 'omr-voiceprints-'))
  locator = { root: async () => storage }
  repository = new FileVoiceprintRepository(locator)
})

afterEach(async () => {
  await rm(storage, { recursive: true, force: true })
})

describe('FileVoiceprintRepository', () => {
  it('保存先が空なら空の一覧を返す', async () => {
    expect(await repository.list()).toEqual([])
  })

  it('書いた声紋を Float32Array として読み戻せる', async () => {
    await repository.put(print('田中さん', [0.6, 0.8]))

    const [entry] = await repository.list()
    expect(entry?.name).toBe('田中さん')
    expect(entry?.vector).toBeInstanceOf(Float32Array)
    expect(Array.from(entry?.vector ?? [])).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)])
  })

  it('同じ名前は差し替え、別の名前は足す', async () => {
    await repository.put(print('田中さん', [1, 0]))
    await repository.put(print('佐藤さん', [0, 1]))
    await repository.put({ ...print('田中さん', [0, 1]), samples: 3 })

    const entries = await repository.list()
    expect(entries.map((entry) => entry.name).sort()).toEqual(['佐藤さん', '田中さん'])
    expect(entries.find((entry) => entry.name === '田中さん')?.samples).toBe(3)
  })

  it('名前を指定して 1 件だけ消せる', async () => {
    await repository.put(print('田中さん', [1, 0]))
    await repository.put(print('佐藤さん', [0, 1]))

    await repository.remove('田中さん')

    expect((await repository.list()).map((entry) => entry.name)).toEqual(['佐藤さん'])
  })

  it('全部消せる', async () => {
    await repository.put(print('田中さん', [1, 0]))

    await repository.clear()

    expect(await repository.list()).toEqual([])
  })

  it('voiceprints.json に保存先ルートへ書き出す', async () => {
    await repository.put(print('田中さん', [1, 0]))

    const content = JSON.parse(
      await readFile(join(storage, 'voiceprints.json'), 'utf8')
    ) as { name: string; vector: number[] }[]
    expect(content[0]?.name).toBe('田中さん')
    expect(content[0]?.vector).toEqual([1, 0])
  })

  it('voiceprints.json が壊れていても空の一覧として扱う', async () => {
    await writeFile(join(storage, 'voiceprints.json'), '{ broken', 'utf8')

    expect(await repository.list()).toEqual([])
  })

  it('形の合わない要素は読み飛ばす', async () => {
    await writeFile(
      join(storage, 'voiceprints.json'),
      JSON.stringify([{ name: '田中さん' }, { ...print('佐藤さん', [0, 1]), vector: [0, 1] }]),
      'utf8'
    )

    expect((await repository.list()).map((entry) => entry.name)).toEqual(['佐藤さん'])
  })
})
