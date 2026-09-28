import { beforeEach, describe, expect, it } from 'vitest'
import {
  ClearSearchIndex,
  GetSearchIndexStatus,
  SearchRecordings,
  SyncSearchIndex
} from '@application/usecases/search'
import { createRecording, initialStepStates, startStep, type Recording } from '@domain/Recording'
import { defaultSettings } from '@domain/Settings'
import type { Speaker } from '@domain/Speaker'
import {
  FakeArtifactStore,
  FakeRecordingRepository,
  FakeSearchIndex,
  FakeSettingsRepository,
  FakeSystemResource,
  FakeTextEmbedder
} from './fakes'

const speakers: Speaker[] = [
  { id: 'self', kind: 'self', label: '自分' },
  { id: 'remote', kind: 'remote', label: '田中' }
]

const ready = (id: string, startedAt: string, title: string): Recording => ({
  ...createRecording({ id, startedAt: new Date(startedAt), title }),
  status: 'ready'
})

const weather = ready('rec-weather', '2026-09-01T10:00:00+09:00', '週次定例')
const budget = ready('rec-budget', '2026-09-02T10:00:00+09:00', '経営会議')

const MODEL_PATH = '/models/bge-m3-q8_0.gguf'

let repository: FakeRecordingRepository
let artifacts: FakeArtifactStore
let index: FakeSearchIndex
let embedder: FakeTextEmbedder
let settings: FakeSettingsRepository
let system: FakeSystemResource

const sync = (): SyncSearchIndex =>
  new SyncSearchIndex({ repository, artifacts, index, embedder, settings, system })

beforeEach(async () => {
  repository = new FakeRecordingRepository()
  artifacts = new FakeArtifactStore()
  index = new FakeSearchIndex()
  embedder = new FakeTextEmbedder()
  system = new FakeSystemResource()
  settings = new FakeSettingsRepository({
    ...defaultSettings('ja'),
    storageDir: '/storage',
    search: { enabled: true, modelPath: MODEL_PATH }
  })

  for (const recording of [weather, budget]) await repository.save(recording)
  await artifacts.writeTranscript(weather, {
    segments: [
      { startMs: 0, endMs: 1_000, speakerId: 'self', text: 'おはようございます' },
      { startMs: 5_000, endMs: 6_000, speakerId: 'remote', text: '今日は雨がひどいですね' }
    ],
    speakers
  })
  await artifacts.writeTranscript(budget, {
    segments: [{ startMs: 0, endMs: 1_000, speakerId: 'self', text: '来期の予算を削ります' }],
    speakers
  })
})

describe('SyncSearchIndex', () => {
  it('索引の無い録音をベクトル化して保存する', async () => {
    const result = await sync().execute()

    expect(result).toMatchObject({ indexed: 2, removed: 0, failed: 0, aborted: false })
    const entry = index.entries.get('rec-weather')
    expect(entry?.modelKey).toBe('fake-model')
    expect(entry?.chunks.map((chunk) => chunk.source)).toEqual(['transcript'])
  })

  it('内容が変わっていない録音は埋め込み直さない', async () => {
    await sync().execute()
    embedder.calls = []

    const result = await sync().execute()

    expect(result.indexed).toBe(0)
    expect(embedder.calls).toEqual([])
  })

  it('メモが書き換わった録音だけを作り直す', async () => {
    await sync().execute()
    embedder.calls = []
    await artifacts.writeNote(budget, '予算は 2 割減')

    const result = await sync().execute()

    expect(result.indexed).toBe(1)
    expect(embedder.calls).toContain('予算は 2 割減')
    expect(index.entries.get('rec-budget')?.chunks.map((chunk) => chunk.source)).toContain('note')
  })

  it('モデルが変わったら全件を作り直す', async () => {
    await sync().execute()
    embedder.modelKey = 'another-model'

    expect((await sync().execute()).indexed).toBe(2)
  })

  it('削除された録音の索引を掃除する', async () => {
    await sync().execute()
    await repository.remove('rec-budget')

    const result = await sync().execute()

    expect(result.removed).toBe(1)
    expect([...index.entries.keys()]).toEqual(['rec-weather'])
  })

  it('録音中・処理中の録音は内容が確定するまで待つ', async () => {
    await repository.save({ ...weather, status: 'recording' })
    await repository.save({
      ...budget,
      status: 'processing',
      steps: startStep(initialStepStates(), 'summarize')
    })

    const result = await sync().execute()

    expect(result.indexed).toBe(0)
    expect(index.entries.size).toBe(0)
  })

  it('1 件の読み込みに失敗しても他の録音は処理する', async () => {
    const original = artifacts.readTranscript.bind(artifacts)
    artifacts.readTranscript = async (recording) => {
      if (recording.id === 'rec-budget') throw new Error('読めません')
      return original(recording)
    }

    const result = await sync().execute()

    expect(result).toMatchObject({ indexed: 1, failed: 1 })
  })

  it('新しい録音から順に処理し、進捗を知らせる', async () => {
    const progress: [number, number][] = []

    await sync().execute({ onProgress: (done, total) => progress.push([done, total]) })

    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2]
    ])
    // 経営会議（9/2）が先。
    expect(embedder.calls[0]).toBe('自分: 来期の予算を削ります')
  })

  it('中断されたら次の録音に進まない', async () => {
    const controller = new AbortController()

    const result = await sync().execute({
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 1) controller.abort()
      }
    })

    expect(result).toMatchObject({ indexed: 1, aborted: true })
  })

  it('メモリが足りなければ埋め込まずに理由を伝える', async () => {
    system.snapshot = { totalBytes: 8 * 1_024 ** 3, availableBytes: 1 * 1_024 ** 3 }

    await expect(sync().execute()).rejects.toThrow('insufficientMemory')
    expect(embedder.calls).toEqual([])
  })

  it('モデルを読み込み済みなら確認しない（確保済みの分を二重に数えない）', async () => {
    embedder.loaded = true
    system.snapshot = { totalBytes: 8 * 1_024 ** 3, availableBytes: 1 * 1_024 ** 3 }

    await expect(sync().execute()).resolves.toMatchObject({ indexed: 2 })
  })

  it('作り直すものが無ければメモリを確認しない（空きが少なくても掃除はできる）', async () => {
    await sync().execute()
    system.snapshot = { totalBytes: 8 * 1_024 ** 3, availableBytes: 1 * 1_024 ** 3 }
    await repository.remove('rec-budget')

    await expect(sync().execute()).resolves.toMatchObject({ removed: 1 })
  })

  it('意味検索が無効なら何もしない', async () => {
    await settings.save({ search: { enabled: false } })

    expect(await sync().execute()).toMatchObject({ indexed: 0, removed: 0 })
    expect(embedder.calls).toEqual([])
  })

  it('埋め込みモデルの失敗は呼び出し側へ伝える', async () => {
    embedder.error = new Error('モデルを読み込めませんでした')

    await expect(sync().execute()).rejects.toThrow('モデルを読み込めませんでした')
  })
})

describe('SearchRecordings', () => {
  const search = (): SearchRecordings =>
    new SearchRecordings({ repository, artifacts, index, embedder, settings, system })

  beforeEach(async () => {
    await sync().execute()
  })

  it('意味の近い録音を、該当箇所の抜粋と時刻付きで返す', async () => {
    const hits = await search().execute({ query: '雨の話' })

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      recordingId: 'rec-weather',
      title: '週次定例',
      source: 'transcript',
      excerpt: '自分: おはようございます 田中: 今日は雨がひどいですね',
      startMs: 0
    })
    expect(hits[0]?.startedAt).toEqual(weather.startedAt)
  })

  it('依頼の言い回しを除いた話題だけを埋め込む', async () => {
    embedder.calls = []

    await search().execute({ query: '雨の話をしたミーティングを教えて' })

    expect(embedder.calls).toEqual(['雨の話'])
  })

  it('空のクエリでは埋め込みを計算しない', async () => {
    embedder.calls = []

    expect(await search().execute({ query: '  ' })).toEqual([])
    expect(embedder.calls).toEqual([])
  })

  it('別のモデルで作った索引は比べない', async () => {
    embedder.modelKey = 'another-model'

    expect(await search().execute({ query: '雨の話' })).toEqual([])
  })

  it('モデルの読み込みに必要なメモリが無ければ、読み込まずに理由を伝える', async () => {
    // 会議中に検索されることがある。数 GB のモデルを黙って載せて OS ごと重くしない。
    // 索引作成でモデルを読んだ後にワーカーが終了し、検索で読み直す状況。
    embedder.loaded = false
    embedder.calls = []
    system.snapshot = { totalBytes: 8 * 1_024 ** 3, availableBytes: 1 * 1_024 ** 3 }

    await expect(search().execute({ query: '雨の話' })).rejects.toThrow(
      'insufficientMemory'
    )
    expect(embedder.calls).toEqual([])
  })

  it('モデルを読み込み済みなら、空きが少なくても検索できる', async () => {
    embedder.loaded = true
    system.snapshot = { totalBytes: 8 * 1_024 ** 3, availableBytes: 1 * 1_024 ** 3 }

    await expect(search().execute({ query: '雨の話' })).resolves.toHaveLength(1)
  })

  it('索引が残っていても、削除済みの録音は返さない', async () => {
    await repository.remove('rec-weather')

    expect(await search().execute({ query: '雨の話' })).toEqual([])
  })
})

describe('GetSearchIndexStatus', () => {
  it('有効かどうか・モデルの有無・索引の件数と容量を返す', async () => {
    system.sizes.set(MODEL_PATH, 634_553_760)
    await sync().execute()

    const status = await new GetSearchIndexStatus({ settings, index, repository, system }).execute()

    expect(status).toEqual({
      enabled: true,
      modelInstalled: true,
      indexedCount: 2,
      recordingCount: 2,
      bytes: 2_000
    })
  })

  it('設定がモデルを指していても、ファイルが無ければ未取得とする', async () => {
    const status = await new GetSearchIndexStatus({ settings, index, repository, system }).execute()

    expect(status.modelInstalled).toBe(false)
  })
})

describe('ClearSearchIndex', () => {
  it('索引をすべて消す', async () => {
    await sync().execute()

    await new ClearSearchIndex(index).execute()

    expect(index.entries.size).toBe(0)
  })
})
