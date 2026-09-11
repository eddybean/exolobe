import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { IndexedChunk, SearchIndexEntry, SearchIndexPort } from '@application/ports'
import type { ChunkLocator, SearchSource } from '@domain/SemanticSearch'
import { readJson, writeJsonAtomic } from '@infrastructure/persistence/jsonFile'

/** ファイル形式の版。読めない版のファイルは壊れたものと同じく無視し、作り直させる。 */
const FILE_VERSION = 1
const EXTENSION = '.json'
/** 録音 ID は UUID。これ以外を受け付けないことで、パスの外へ書き出す余地を無くす。 */
const SAFE_ID = /^[\w-]+$/

interface StoredChunk {
  readonly source: SearchSource
  readonly locator: ChunkLocator
  /** Float32 のバイト列を base64 にしたもの。数値の配列より 1/3 程度小さい。 */
  readonly vector: string
}

interface StoredEntry {
  readonly version: typeof FILE_VERSION
  readonly recordingId: string
  readonly fingerprint: string
  readonly modelKey: string
  readonly chunks: readonly StoredChunk[]
}

const SOURCES: readonly string[] = ['title', 'summary', 'note', 'transcript']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isLocator = (value: unknown): value is ChunkLocator => {
  if (!isRecord(value)) return false
  switch (value['kind']) {
    case 'whole':
      return true
    case 'segments':
      return typeof value['from'] === 'number' && typeof value['to'] === 'number'
    case 'range':
      return typeof value['start'] === 'number' && typeof value['end'] === 'number'
    default:
      return false
  }
}

const isStoredChunk = (value: unknown): value is StoredChunk =>
  isRecord(value) &&
  typeof value['source'] === 'string' &&
  SOURCES.includes(value['source']) &&
  isLocator(value['locator']) &&
  typeof value['vector'] === 'string'

const isStoredEntry = (value: unknown): value is StoredEntry =>
  isRecord(value) &&
  value['version'] === FILE_VERSION &&
  typeof value['recordingId'] === 'string' &&
  typeof value['fingerprint'] === 'string' &&
  typeof value['modelKey'] === 'string' &&
  Array.isArray(value['chunks']) &&
  value['chunks'].every(isStoredChunk)

const encodeVector = (vector: Float32Array): string =>
  Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64')

const decodeVector = (encoded: string): Float32Array => {
  const bytes = Buffer.from(encoded, 'base64')
  // Buffer は共有プールの途中から切り出されることがあり、Float32Array に必要な
  // 4 バイト境界に揃っている保証が無い。コピーしてから読む。
  const aligned = new Uint8Array(bytes.byteLength)
  aligned.set(bytes)
  return new Float32Array(aligned.buffer, 0, Math.floor(bytes.byteLength / 4))
}

const toStored = (entry: SearchIndexEntry): StoredEntry => ({
  version: FILE_VERSION,
  recordingId: entry.recordingId,
  fingerprint: entry.fingerprint,
  modelKey: entry.modelKey,
  chunks: entry.chunks.map((chunk) => ({
    source: chunk.source,
    locator: chunk.locator,
    vector: encodeVector(chunk.vector)
  }))
})

const fromStored = (stored: StoredEntry): SearchIndexEntry => ({
  recordingId: stored.recordingId,
  fingerprint: stored.fingerprint,
  modelKey: stored.modelKey,
  chunks: stored.chunks.map(
    (chunk): IndexedChunk => ({
      source: chunk.source,
      locator: chunk.locator,
      vector: decodeVector(chunk.vector)
    })
  )
})

/**
 * 意味検索の索引を userData/search/ に 1 録音 1 ファイルで置く。
 *
 * 保存先ルートではなく userData に置くのは、モデルと同じく再生成できるものだから。
 * 保存先はクラウド同期されていることがあり、そこへ数十 MB のキャッシュを混ぜない。
 * 1 録音 1 ファイルにしたのは、1 件の更新で全体を書き直さずに済み、壊れても
 * その 1 件を作り直すだけで済むため。
 *
 * 読み込んだ内容はプロセス内に持つ。検索のたびに全ファイルを読み直すと、数百件で
 * 数十 MB の JSON を毎回解析することになる。書き込むのはこのインスタンスだけ
 * （他プロセスは clear の前にこのプロセスを止める）なので、手元の写しがずれない。
 */
export class FileSearchIndex implements SearchIndexPort {
  private cache: Map<string, SearchIndexEntry> | undefined

  constructor(private readonly root: string) {}

  async list(): Promise<SearchIndexEntry[]> {
    return [...(await this.load()).values()]
  }

  async put(entry: SearchIndexEntry): Promise<void> {
    const path = this.pathFor(entry.recordingId)
    const entries = await this.load()
    await writeJsonAtomic(path, toStored(entry))
    entries.set(entry.recordingId, entry)
  }

  async remove(recordingId: string): Promise<void> {
    const path = this.pathFor(recordingId)
    await rm(path, { force: true })
    this.cache?.delete(recordingId)
  }

  async clear(): Promise<void> {
    await rm(this.root, { recursive: true, force: true })
    this.cache = new Map()
  }

  async stats(): Promise<{ count: number; bytes: number }> {
    let count = 0
    let bytes = 0
    for (const name of await this.entryFiles()) {
      try {
        bytes += (await stat(join(this.root, name))).size
        count += 1
      } catch {
        // 数えている間に消えたファイルは、無かったものとして扱う。
      }
    }
    return { count, bytes }
  }

  private async load(): Promise<Map<string, SearchIndexEntry>> {
    if (this.cache) return this.cache

    const entries = new Map<string, SearchIndexEntry>()
    for (const name of await this.entryFiles()) {
      const stored = await readJson(join(this.root, name))
      // 壊れたファイルは読み飛ばす。次の同期で fingerprint が合わず作り直される。
      if (isStoredEntry(stored)) entries.set(stored.recordingId, fromStored(stored))
    }

    this.cache = entries
    return entries
  }

  private async entryFiles(): Promise<string[]> {
    try {
      return (await readdir(this.root)).filter((name) => name.endsWith(EXTENSION))
    } catch {
      return []
    }
  }

  private pathFor(recordingId: string): string {
    if (!SAFE_ID.test(recordingId)) {
      throw new Error(`索引に使えない録音 ID です: ${recordingId}`)
    }
    return join(this.root, `${recordingId}${EXTENSION}`)
  }
}
