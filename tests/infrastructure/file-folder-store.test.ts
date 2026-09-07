import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FileFolderRepository,
  type StorageLocator
} from '@infrastructure/persistence/FileFolderStore'

let storage: string
let locator: StorageLocator
let repository: FileFolderRepository

beforeEach(async () => {
  storage = await mkdtemp(join(tmpdir(), 'omr-folders-'))
  locator = { root: async () => storage }
  repository = new FileFolderRepository(locator)
})

afterEach(async () => {
  await rm(storage, { recursive: true, force: true })
})

describe('FileFolderRepository', () => {
  it('保存先が空なら空の一覧を返す', async () => {
    expect(await repository.list()).toEqual([])
  })

  it('フォルダの一覧を保存して読み戻せる', async () => {
    await repository.replaceAll([
      { id: 'f1', name: '議事録' },
      { id: 'f2', name: '子', parentId: 'f1' }
    ])

    expect(await repository.list()).toEqual([
      { id: 'f1', name: '議事録' },
      { id: 'f2', name: '子', parentId: 'f1' }
    ])
  })

  it('folders.json にそのまま書き出す', async () => {
    await repository.replaceAll([{ id: 'f1', name: '議事録' }])

    const content = JSON.parse(await readFile(join(storage, 'folders.json'), 'utf8')) as unknown[]
    expect(content).toEqual([{ id: 'f1', name: '議事録' }])
  })

  it('置き換えは全体を上書きする', async () => {
    await repository.replaceAll([{ id: 'f1', name: 'A' }])
    await repository.replaceAll([{ id: 'f2', name: 'B' }])

    expect(await repository.list()).toEqual([{ id: 'f2', name: 'B' }])
  })

  it('folders.json が壊れていても空の一覧として扱う', async () => {
    await writeFile(join(storage, 'folders.json'), '{ broken', 'utf8')

    expect(await repository.list()).toEqual([])
  })
})
