import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { IndexedChunk, SearchIndexEntry, SearchIndexPort } from '@application/ports'
import type { ChunkLocator, SearchSource } from '@domain/SemanticSearch'
import { readJson, writeJsonAtomic } from '@infrastructure/persistence/jsonFile'

/** userData 配下のディレクトリ名。main と検索ワーカーで同じ場所を指すために共有する。 */
export const SEARCH_INDEX_DIR = 'search'

/** ファイル形式の版。読めない版のファイルは壊れたものと同じく無視し、作り直させる。 */
const FILE_VERSION = 1
const EXTENSION = '.json'
/** 録音 ID は UUID。これ以外を受け付けないことで、パスの外へ書き出す余地を無くす。 */
const SAFE_ID = /^[\w-]+$/

interface StoredChunk {
  readonly source: SearchSource
  readonly locator: ChunkLocator
  /** 8 ビットに量子化したベクトルを base64 にしたもの。 */
  readonly vector: string
  /** 量子化の刻み幅。元の値 ≒ 保存値 × scale。 */
  readonly scale: number
}

interface StoredEntry {
  readonly version: typeof FILE_VERSION
  readonly recordingId: string
  readonly fingerprint: string
  readonly modelKey: string
  readonly chunks: readonly StoredChunk[]
}

const SOURCES: readonly string[] = ['summary', 'note', 'transcript']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isLocator = (value: unknown): value is ChunkLocator => {
  if (!isRecord(value)) return false
  switch (value['kind']) {
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
  typeof value['vector'] === 'string' &&
  typeof value['scale'] === 'number'

const isStoredEntry = (value: unknown): value is StoredEntry =>
  isRecord(value) &&
  value['version'] === FILE_VERSION &&
  typeof value['recordingId'] === 'string' &&
  typeof value['fingerprint'] === 'string' &&
  typeof value['modelKey'] === 'string' &&
  Array.isArray(value['chunks']) &&
  value['chunks'].every(isStoredChunk)

/**
 * ベクトルを 1 次元 1 バイトに量子化する。
 *
 * 文字起こしを細かく重ねて切るため、1 時間の会議で 150 前後のチャンクになる。
 * Float32 のままでは 1 時間あたり約 800KB だが、8 ビットなら約 200KB で済む。
 * 刻み幅はベクトルごとに最大の絶対値から決めるので、類似度の誤差は 0.001 程度に
 * 収まり、順位付けには影響しない。
 */
const quantize = (vector: Float32Array): { vector: string; scale: number } => {
  let max = 0
  for (const value of vector) max = Math.max(max, Math.abs(value))
  const scale = max / 127
  const bytes = Int8Array.from(vector, (value) => (scale === 0 ? 0 : Math.round(value / scale)))
  return {
    vector: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    scale
  }
}

const dequantize = (encoded: string, scale: number): Float32Array => {
  const bytes = Buffer.from(encoded, 'base64')
  const values = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Float32Array.from(values, (value) => value * scale)
}

const toStored = (entry: SearchIndexEntry): StoredEntry => ({
  version: FILE_VERSION,
  recordingId: entry.recordingId,
  fingerprint: entry.fingerprint,
  modelKey: entry.modelKey,
  chunks: entry.chunks.map((chunk) => ({
    source: chunk.source,
    locator: chunk.locator,
    ...quantize(chunk.vector)
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
      vector: dequantize(chunk.vector, chunk.scale)
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
