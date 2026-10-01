import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileFolderRepository, type StorageLocator } from '@infrastructure/persistence/FileFolderStore'

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

  it('壊れた folders.json は書き込む前に退避する（フォルダ名は再生成できない）', async () => {
    await writeFile(join(storage, 'folders.json'), '{ broken', 'utf8')

    await repository.replaceAll([{ id: 'f1', name: '議事録' }])

    const [quarantined] = (await readdir(storage)).filter((name) => name.startsWith('folders.json.unreadable-'))
    expect(await readFile(join(storage, quarantined ?? ''), 'utf8')).toBe('{ broken')
    expect(await repository.list()).toEqual([{ id: 'f1', name: '議事録' }])
  })

  it('読めない要素や知らないキーを書き戻しで消さない（新しい版のデータを古い版で壊さない）', async () => {
    await writeFile(
      join(storage, 'folders.json'),
      JSON.stringify([
        { id: 'f1', name: '議事録', color: 'blue' },
        { id: 'f2', name: '子', parentId: 'f1', color: 'red' },
        { id: 'f3', name: '消す' },
        { future: true }
      ]),
      'utf8'
    )

    // f1 の改名、f2 をトップレベルへ移動、f3 の削除を一度に行う。
    await repository.replaceAll([
      { id: 'f1', name: '会議' },
      { id: 'f2', name: '子' }
    ])

    const content = JSON.parse(await readFile(join(storage, 'folders.json'), 'utf8')) as unknown[]
    expect(content).toEqual([
      { id: 'f1', name: '会議', color: 'blue' },
      { id: 'f2', name: '子', color: 'red' },
      { future: true }
    ])
  })
})
