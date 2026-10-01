import type {
  IndexedChunk,
  RecordingArtifactPort,
  RecordingRepositoryPort,
  SearchIndexPort,
  SettingsRepositoryPort,
  SystemResourcePort,
  TextEmbedderPort
} from '@application/ports'
import { AppError } from '@domain/errors'
import { estimateEmbeddingBytes, insufficientMemory } from '@domain/MemoryGuard'
import { findAsset } from '@domain/ModelCatalog'
import { isProcessing, type Recording } from '@domain/Recording'
import {
  DEFAULT_SEARCH_LIMIT,
  buildSearchDocuments,
  excerptFor,
  fingerprint,
  focusQuery,
  rankRecordings,
  type SearchDocument,
  type SearchMaterial,
  type SearchSource
} from '@domain/SemanticSearch'

const loadMaterial = async (artifacts: RecordingArtifactPort, recording: Recording): Promise<SearchMaterial> => {
  const transcript = await artifacts.readTranscript(recording)

  return {
    segments: transcript?.segments ?? [],
    speakers: transcript?.speakers ?? [],
    summary: await artifacts.readSummary(recording),
    note: await artifacts.readNote(recording)
  }
}

/** 録音中や処理中は成果物がこれから書き換わるので、確定してから読む。 */
export const isSettled = (recording: Recording): boolean =>
  recording.status !== 'recording' && !isProcessing(recording.steps)

const newestFirst = (recordings: readonly Recording[]): Recording[] =>
  [...recordings].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())

export interface SyncSearchIndexResult {
  readonly indexed: number
  readonly removed: number
  readonly failed: number
  readonly aborted: boolean
}

export interface SyncSearchIndexDeps {
  readonly repository: RecordingRepositoryPort
  readonly artifacts: RecordingArtifactPort
  readonly index: SearchIndexPort
  readonly embedder: TextEmbedderPort
  readonly settings: SettingsRepositoryPort
  readonly system: SystemResourcePort
}

/**
 * 数 GB のモデルを読み込む前に空きを確認し、足りなければ断る。
 *
 * 索引作成だけでなく検索でも通す。会議中に検索されることがあり、そこで黙って
 * モデルを載せると OS ごと重くなる（ADR-024 が要約・文字起こしで守っているのと同じ）。
 * 読み込み済みなら確保済みなので確認しない。空きから引かれた分を要求側にも数えると、
 * 動いているモデルを理由に断ってしまう。
 */
const ensureEmbeddingMemory = async (
  deps: {
    readonly settings: SettingsRepositoryPort
    readonly system: SystemResourcePort
    readonly embedder: TextEmbedderPort
  },
  task: 'search' | 'searchIndex'
): Promise<void> => {
  if (deps.embedder.loaded) return

  const settings = await deps.settings.load()
  if (settings.memoryProtection === 'off') return

  const modelFileBytes = (await deps.system.fileSize(settings.search.modelPath)) ?? findAsset('search-model')?.bytes
  if (modelFileBytes === undefined) return

  const shortage = insufficientMemory({
    snapshot: await deps.system.memory(),
    demand: { bytes: estimateEmbeddingBytes({ modelFileBytes }), task },
    protection: settings.memoryProtection
  })
  if (shortage) throw new AppError(shortage)
}

/**
 * 索引を録音一覧に合わせる。
 *
 * 「何が変わったか」を各所から通知してもらうのではなく、毎回すべての録音の中身から
 * fingerprint を計算して比べる。メモ編集・再要約・話者名変更…と経路が多く、
 * どれか 1 つの通知漏れで索引が古いまま残るより、比較のコスト（文字列の連結と
 * ハッシュ）を払う方が確実。埋め込みの計算は変わった録音にしか行わない。
 */
export class SyncSearchIndex {
  constructor(private readonly deps: SyncSearchIndexDeps) {}

  async execute(
    options: {
      signal?: AbortSignal
      onProgress?: (done: number, total: number) => void
    } = {}
  ): Promise<SyncSearchIndexResult> {
    const settings = await this.deps.settings.load()
    if (!settings.search.enabled) return { indexed: 0, removed: 0, failed: 0, aborted: false }

    const { repository, artifacts, index, embedder } = this.deps
    const recordings = await repository.list()
    const entries = await index.list()

    const existing = new Set(recordings.map((recording) => recording.id))
    let removed = 0
    for (const entry of entries) {
      if (existing.has(entry.recordingId)) continue
      await index.remove(entry.recordingId)
      removed += 1
    }

    const indexedFingerprints = new Map(entries.map((entry) => [entry.recordingId, entry.fingerprint]))
    const pending: { recording: Recording; documents: SearchDocument[]; fingerprint: string }[] = []
    let failed = 0

    for (const recording of newestFirst(recordings)) {
      if (!isSettled(recording)) continue

      let material: SearchMaterial
      try {
        material = await loadMaterial(artifacts, recording)
      } catch {
        // 1 件の成果物が読めないことを理由に、他の録音を検索できなくはしない。
        failed += 1
        continue
      }

      const documents = buildSearchDocuments(material)
      if (documents.length === 0) {
        if (indexedFingerprints.has(recording.id)) {
          await index.remove(recording.id)
          removed += 1
        }
        continue
      }

      const current = fingerprint(embedder.modelKey, documents)
      if (indexedFingerprints.get(recording.id) === current) continue

      pending.push({ recording, documents, fingerprint: current })
    }

    if (pending.length > 0) await ensureEmbeddingMemory(this.deps, 'searchIndex')

    let indexed = 0
    let aborted = false
    options.onProgress?.(0, pending.length)

    for (const item of pending) {
      if (options.signal?.aborted) {
        aborted = true
        break
      }

      // 1 チャンクずつ待つ。同じワーカーに届いた検索のクエリが、同期の途中でも
      // チャンク 1 つ分の待ちで割り込めるようにするため。
      const chunks: IndexedChunk[] = []
      for (const { source, locator, text } of item.documents) {
        chunks.push({ source, locator, vector: await embedder.embed(text) })
      }

      await index.put({
        recordingId: item.recording.id,
        fingerprint: item.fingerprint,
        modelKey: embedder.modelKey,
        chunks
      })
      indexed += 1
      options.onProgress?.(indexed, pending.length)
    }

    return { indexed, removed, failed, aborted }
  }
}

export interface SearchHit {
  readonly recordingId: string
  readonly title: string
  readonly startedAt: Date
  readonly score: number
  readonly source: SearchSource
  readonly excerpt: string
  /** 文字起こしで当たった場合の、該当区間の開始時刻。 */
  readonly startMs?: number
}

export interface SearchRecordingsDeps {
  readonly repository: RecordingRepositoryPort
  readonly artifacts: RecordingArtifactPort
  readonly index: SearchIndexPort
  readonly embedder: TextEmbedderPort
  readonly settings: SettingsRepositoryPort
  readonly system: SystemResourcePort
}

export class SearchRecordings {
  constructor(private readonly deps: SearchRecordingsDeps) {}

  async execute(params: { query: string; limit?: number }): Promise<SearchHit[]> {
    if (!params.query.trim()) return []

    const { repository, artifacts, index, embedder } = this.deps
    await ensureEmbeddingMemory(this.deps, 'search')
    const vector = await embedder.embed(focusQuery(params.query))

    const recordings = new Map((await repository.list()).map((recording) => [recording.id, recording]))
    // 別モデルのベクトルとは空間が違い、比べても意味のある値にならない。
    // 削除済みの録音は次の同期で掃除されるまで索引に残るので、ここでも除く。
    const entries = (await index.list()).filter(
      (entry) => entry.modelKey === embedder.modelKey && recordings.has(entry.recordingId)
    )

    const hits = rankRecordings(vector, entries, { limit: params.limit ?? DEFAULT_SEARCH_LIMIT })

    const results = await Promise.all(
      hits.map(async (hit): Promise<SearchHit | undefined> => {
        const recording = recordings.get(hit.recordingId)
        if (!recording) return undefined

        const material = await loadMaterial(artifacts, recording)
        const { excerpt, startMs } = excerptFor(hit.chunk.source, hit.chunk.locator, material)

        return {
          recordingId: recording.id,
          title: recording.title,
          startedAt: recording.startedAt,
          score: hit.score,
          source: hit.chunk.source,
          excerpt,
          ...(startMs === undefined ? {} : { startMs })
        }
      })
    )

    return results.filter((result): result is SearchHit => result !== undefined)
  }
}

export interface SearchIndexStatus {
  readonly enabled: boolean
  readonly modelInstalled: boolean
  readonly indexedCount: number
  readonly recordingCount: number
  readonly bytes: number
}

export class GetSearchIndexStatus {
  constructor(
    private readonly deps: {
      readonly settings: SettingsRepositoryPort
      readonly index: SearchIndexPort
      readonly repository: RecordingRepositoryPort
      readonly system: SystemResourcePort
    }
  ) {}

  async execute(): Promise<SearchIndexStatus> {
    const { search } = await this.deps.settings.load()
    const stats = await this.deps.index.stats()
    const recordings = await this.deps.repository.list()
    // 設定だけが残ってファイルが消えている場合を「取得済み」と見せない。
    const modelInstalled = search.modelPath !== '' && (await this.deps.system.fileSize(search.modelPath)) !== undefined

    return {
      enabled: search.enabled,
      modelInstalled,
      indexedCount: stats.count,
      recordingCount: recordings.length,
      bytes: stats.bytes
    }
  }
}

export class ClearSearchIndex {
  constructor(private readonly index: SearchIndexPort) {}

  async execute(): Promise<void> {
    await this.index.clear()
  }
}
