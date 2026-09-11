import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SearchIndexEntry } from '@application/ports'
import { FileSearchIndex } from '@infrastructure/search/FileSearchIndex'

let root: string
let base: string

const entry = (recordingId: string, values: number[] = [0.5, -0.25, 1]): SearchIndexEntry => ({
  recordingId,
  fingerprint: 'fp-1',
  modelKey: 'bge-m3-q8_0.gguf',
  chunks: [
    {
      source: 'summary',
      locator: { kind: 'range', start: 0, end: 12 },
      vector: Float32Array.from(values)
    },
    {
      source: 'transcript',
      locator: { kind: 'segments', from: 0, to: 3 },
      vector: Float32Array.from(values.map((value) => value * 2))
    }
  ]
})

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'omr-search-'))
  // 実際の置き場所（userData/search）と同じく、まだ作られていない状態から始める。
  root = join(base, 'search')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('FileSearchIndex', () => {
  it('まだ何も無ければ空として扱う', async () => {
    const index = new FileSearchIndex(root)

    expect(await index.list()).toEqual([])
    expect(await index.stats()).toEqual({ count: 0, bytes: 0 })
  })

  it('保存した索引を別のインスタンスから読み戻せる', async () => {
    await new FileSearchIndex(root).put(entry('rec-1'))

    const [restored] = await new FileSearchIndex(root).list()

    expect(restored).toMatchObject({
      recordingId: 'rec-1',
      fingerprint: 'fp-1',
      modelKey: 'bge-m3-q8_0.gguf',
      chunks: [
        { source: 'summary', locator: { kind: 'range', start: 0, end: 12 } },
        { source: 'transcript', locator: { kind: 'segments', from: 0, to: 3 } }
      ]
    })
    expect(restored?.chunks[0]?.vector).toBeInstanceOf(Float32Array)
  })

  it('ベクトルは 8 ビットに詰めて保存し、類似度が変わらない精度で戻す', async () => {
    // 正規化済みの 1024 次元ベクトル（bge-m3 と同じ形）。
    const raw = Array.from({ length: 1_024 }, (_, i) => Math.sin(i * 0.37) + Math.cos(i * 0.11))
    const length = Math.hypot(...raw)
    const vector = raw.map((value) => value / length)
    await new FileSearchIndex(root).put(entry('rec-1', vector))

    const [restored] = await new FileSearchIndex(root).list()
    const back = restored?.chunks[0]?.vector ?? new Float32Array()
    const cosine = vector.reduce((sum, value, i) => sum + value * (back[i] ?? 0), 0)

    expect(cosine).toBeGreaterThan(0.999)
    // 1 チャンクあたり Float32 の base64（約 5.5KB）の 1/3 未満に収まる。
    const { bytes } = await new FileSearchIndex(root).stats()
    expect(bytes).toBeLessThan(2 * 2_000)
  })

  it('ゼロベクトルも壊さずに往復できる', async () => {
    await new FileSearchIndex(root).put(entry('rec-1', [0, 0, 0]))

    const [restored] = await new FileSearchIndex(root).list()

    expect(Array.from(restored?.chunks[0]?.vector ?? [])).toEqual([0, 0, 0])
  })

  it('同じ録音は上書きする', async () => {
    const index = new FileSearchIndex(root)
    await index.put(entry('rec-1'))
    await index.put({ ...entry('rec-1'), fingerprint: 'fp-2' })

    const entries = await new FileSearchIndex(root).list()

    expect(entries.map((item) => item.fingerprint)).toEqual(['fp-2'])
  })

  it('録音 1 件分を消す。無いものを消しても失敗しない', async () => {
    const index = new FileSearchIndex(root)
    await index.put(entry('rec-1'))
    await index.put(entry('rec-2'))

    await index.remove('rec-1')
    await index.remove('rec-missing')

    expect((await new FileSearchIndex(root).list()).map((item) => item.recordingId)).toEqual([
      'rec-2'
    ])
  })

  it('すべて消した後も続けて使える', async () => {
    const index = new FileSearchIndex(root)
    await index.put(entry('rec-1'))

    await index.clear()

    expect(await index.list()).toEqual([])
    expect(await index.stats()).toEqual({ count: 0, bytes: 0 })
    await index.put(entry('rec-2'))
    expect((await index.list()).map((item) => item.recordingId)).toEqual(['rec-2'])
  })

  it('件数と容量を返す。書き込み途中の一時ファイルは数えない', async () => {
    const index = new FileSearchIndex(root)
    await index.put(entry('rec-1'))
    await writeFile(join(root, 'rec-2.json.tmp'), 'x'.repeat(10_000))

    const stats = await index.stats()

    expect(stats.count).toBe(1)
    expect(stats.bytes).toBeGreaterThan(0)
    expect(stats.bytes).toBeLessThan(10_000)
  })

  it('壊れたファイルは無視する（索引は作り直せるので起動や検索を止めない）', async () => {
    const index = new FileSearchIndex(root)
    await index.put(entry('rec-1'))
    await writeFile(join(root, 'rec-2.json'), '{ broken')
    await writeFile(join(root, 'rec-3.json'), JSON.stringify({ recordingId: 'rec-3' }))

    const entries = await new FileSearchIndex(root).list()

    expect(entries.map((item) => item.recordingId)).toEqual(['rec-1'])
  })

  it('パスとして危険な ID は受け付けない', async () => {
    const index = new FileSearchIndex(root)

    await expect(index.put(entry('../escape'))).rejects.toThrow()
    await expect(index.remove('../escape')).rejects.toThrow()
    expect(await readdir(base)).toEqual([])
  })
})
