import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
  sources: [{ key: `rec-1:remote:spk0`, vector: Float32Array.from(vector) }],
  modelKey: 'campplus:192',
  updatedAt: '2026-09-13T12:00:00.000Z'
})

/** ファイルへ直接書くときの素の形（Float32Array は JSON で配列にならない）。 */
const record = (name: string): Record<string, unknown> => ({
  name,
  vector: [0, 1],
  sources: [{ key: 'rec-1:remote:spk0', vector: [0, 1] }],
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
    expect(entry?.sources[0]?.key).toBe('rec-1:remote:spk0')
    expect(entry?.sources[0]?.vector).toBeInstanceOf(Float32Array)
  })

  it('出所を持たない声紋は読み飛ばす（取り消せない声紋を残さない）', async () => {
    await writeFile(
      join(storage, 'voiceprints.json'),
      JSON.stringify([{ ...record('田中さん'), sources: [] }]),
      'utf8'
    )

    expect(await repository.list()).toEqual([])
  })

  it('同じ名前は差し替え、別の名前は足す', async () => {
    await repository.put(print('田中さん', [1, 0]))
    await repository.put(print('佐藤さん', [0, 1]))
    await repository.put({
      ...print('田中さん', [0, 1]),
      sources: [
        { key: 'rec-1:remote:spk0', vector: Float32Array.from([0, 1]) },
        { key: 'rec-2:remote:spk0', vector: Float32Array.from([0, 1]) },
        { key: 'rec-3:remote:spk0', vector: Float32Array.from([0, 1]) }
      ]
    })

    const entries = await repository.list()
    expect(entries.map((entry) => entry.name).sort()).toEqual(['佐藤さん', '田中さん'])
    expect(entries.find((entry) => entry.name === '田中さん')?.sources).toHaveLength(3)
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

  it('壊れた voiceprints.json は書き込む前に退避する（再生成できないので上書きで消さない）', async () => {
    await writeFile(join(storage, 'voiceprints.json'), '{ broken', 'utf8')

    await repository.put(print('田中さん', [1, 0]))

    const [quarantined] = (await readdir(storage)).filter((name) =>
      name.startsWith('voiceprints.json.unreadable-')
    )
    expect(quarantined).toBeDefined()
    expect(await readFile(join(storage, quarantined ?? ''), 'utf8')).toBe('{ broken')
    expect((await repository.list()).map((entry) => entry.name)).toEqual(['田中さん'])
  })

  it('配列でない voiceprints.json も読めないものとして退避する', async () => {
    await writeFile(join(storage, 'voiceprints.json'), '{"entries":[]}', 'utf8')

    await repository.put(print('田中さん', [1, 0]))

    expect(
      (await readdir(storage)).some((name) => name.startsWith('voiceprints.json.unreadable-'))
    ).toBe(true)
  })

  it('読めない要素や知らないキーを書き戻しで消さない（新しい版のデータを古い版で壊さない）', async () => {
    await writeFile(
      join(storage, 'voiceprints.json'),
      JSON.stringify([
        { name: '未来の形', embedding: { dims: 2 } },
        { ...record('佐藤さん'), futureField: 'keep' },
        record('田中さん')
      ]),
      'utf8'
    )

    await repository.put(print('鈴木さん', [1, 0]))
    await repository.remove('田中さん')

    const content = JSON.parse(
      await readFile(join(storage, 'voiceprints.json'), 'utf8')
    ) as Record<string, unknown>[]
    expect(content).toContainEqual({ name: '未来の形', embedding: { dims: 2 } })
    expect(content).toContainEqual({ ...record('佐藤さん'), futureField: 'keep' })
    expect(content.map((entry) => entry['name'])).not.toContain('田中さん')
    expect(content.map((entry) => entry['name'])).toContain('鈴木さん')
  })

  it('全部消すときは読めない要素も消す（利用者が明示的に選んだ操作）', async () => {
    await writeFile(
      join(storage, 'voiceprints.json'),
      JSON.stringify([{ name: '未来の形' }, record('佐藤さん')]),
      'utf8'
    )

    await repository.clear()

    expect(JSON.parse(await readFile(join(storage, 'voiceprints.json'), 'utf8'))).toEqual([])
  })

  it('数値でない成分を含む声紋は読み飛ばす（NaN は閾値の検査を素通りする）', async () => {
    await writeFile(
      join(storage, 'voiceprints.json'),
      JSON.stringify([
        { ...record('田中さん'), vector: ['x', 1] },
        record('佐藤さん')
      ]),
      'utf8'
    )

    expect((await repository.list()).map((entry) => entry.name)).toEqual(['佐藤さん'])
  })

  it('形の合わない要素は読み飛ばす', async () => {
    await writeFile(
      join(storage, 'voiceprints.json'),
      JSON.stringify([{ name: '田中さん' }, record('佐藤さん')]),
      'utf8'
    )

    expect((await repository.list()).map((entry) => entry.name)).toEqual(['佐藤さん'])
  })
})
