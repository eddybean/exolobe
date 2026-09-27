import { describe, expect, it } from 'vitest'
import {
  CancelModelDownload,
  DeleteModel,
  DownloadModel,
  GetModelStatus,
  UpdateModel,
  type ModelStorePort
} from '@application/usecases/models'
import { MANAGED_ASSETS, findAsset, formatBytes, requiredAssets } from '@domain/ModelCatalog'
import type { ManagedAsset, ManagedAssetId } from '@domain/ModelCatalog'
import {
  initialStepStates,
  startStep,
  succeedStep,
  type Recording,
  type StepStates
} from '@domain/Recording'
import { defaultSettings } from '@domain/Settings'
import { FakeRecordingRepository, FakeSettingsRepository } from './fakes'

class FakeModelStore implements ModelStorePort {
  /** 存在するとみなすパス。 */
  present = new Set<string>()
  fetched: string[] = []
  cancelled: string[] = []
  removed: string[] = []
  /** 記録済みのチェックサム（パスごと）。無いパスは「分からない」。 */
  digests = new Map<string, string>()
  failWith?: Error

  pathFor(asset: ManagedAsset): string {
    return `/models/${asset.entryPath ?? asset.fileName}`
  }
  async exists(path: string): Promise<boolean> {
    return this.present.has(path)
  }
  async installedDigest(_asset: ManagedAsset, path: string): Promise<string | undefined> {
    return this.digests.get(path)
  }
  async fetch(
    asset: ManagedAsset,
    options: { onProgress?: (received: number, total: number | undefined) => void }
  ): Promise<string> {
    if (this.failWith) throw this.failWith
    this.fetched.push(asset.id)
    options.onProgress?.(asset.bytes, asset.bytes)
    const path = this.pathFor(asset)
    this.present.add(path)
    return path
  }
  cancel(id: ManagedAssetId): void {
    this.cancelled.push(id)
  }
  async remove(asset: ManagedAsset): Promise<void> {
    this.removed.push(asset.id)
    this.present.delete(this.pathFor(asset))
  }
}

describe('ModelCatalog', () => {
  it('文字起こし・無音検出・要約のモデルは必須、話者識別は任意にする', () => {
    expect(requiredAssets().map((a) => a.id)).toEqual([
      'transcription-model',
      'vad-model',
      'summarization-model'
    ])
  })

  it('必須モデルにはチェックサムを持たせる', () => {
    for (const asset of requiredAssets()) {
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('すべての取得先を HTTPS にする', () => {
    for (const asset of MANAGED_ASSETS) {
      expect(asset.url.startsWith('https://')).toBe(true)
    }
  })

  it('各モデルは設定の対応する項目へ書き込まれる', () => {
    const patches = MANAGED_ASSETS.map((asset) => asset.applyTo('/p'))

    expect(patches).toEqual([
      { transcription: { modelPath: '/p' } },
      // Core ML エンコーダは whisper.cpp がモデルのパスから名前を導いて探すため、
      // 設定に書く項目が無い。
      {},
      { transcription: { vadModelPath: '/p' } },
      { summarization: { modelPath: '/p' } },
      { diarization: { segmentationModelPath: '/p' } },
      { diarization: { embeddingModelPath: '/p' } },
      { search: { modelPath: '/p' } }
    ])
  })

  it('意味検索モデルは任意にし、取得物をチェックサムで確かめる', () => {
    const asset = findAsset('search-model')

    expect(asset?.optional).toBe(true)
    expect(asset?.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('Core ML エンコーダは文字起こしモデルの隣に置く名前で配布されている', () => {
    const encoder = findAsset('transcription-coreml-encoder')
    const model = findAsset('transcription-model')

    // whisper.cpp は '<モデル名から -q5_0 を除いたもの>-encoder.mlmodelc' を探す。
    // この対応が崩れると Core ML が黙って無効になるため、名前で縛っておく。
    expect(model?.fileName).toBe('ggml-large-v3-turbo-q5_0.bin')
    expect(encoder?.entryPath).toBe(
      'ggml-large-v3-turbo-encoder.mlmodelc/weights/weight.bin'
    )
  })

  it('Core ML エンコーダは任意にする。無くても文字起こしは動く', () => {
    expect(findAsset('transcription-coreml-encoder')?.optional).toBe(true)
  })
})

describe('formatBytes', () => {
  it('人が読める単位にする', () => {
    expect(formatBytes(5_154_941_280)).toBe('5.2GB')
    expect(formatBytes(574_041_195)).toBe('574MB')
    expect(formatBytes(7_000)).toBe('7KB')
  })
})

describe('GetModelStatus', () => {
  it('未取得のモデルを未インストールとして返す', async () => {
    const store = new FakeModelStore()
    const status = await new GetModelStatus(
      new FakeSettingsRepository(defaultSettings()),
      store
    ).execute()

    expect(status).toHaveLength(MANAGED_ASSETS.length)
    expect(status.every((s) => !s.installed)).toBe(true)
    expect(status[0]?.path).toBeUndefined()
  })

  it('設定されたパスが実在すればインストール済みとする', async () => {
    const store = new FakeModelStore()
    store.present.add('/custom/whisper.bin')

    const settings = new FakeSettingsRepository({
      ...defaultSettings(),
      transcription: { ...defaultSettings().transcription, modelPath: '/custom/whisper.bin' }
    })

    const status = await new GetModelStatus(settings, store).execute()
    const transcription = status.find((s) => s.id === 'transcription-model')

    expect(transcription?.installed).toBe(true)
    expect(transcription?.path).toBe('/custom/whisper.bin')
  })

  it('設定されたパスのファイルが消えていれば未インストールに戻す', async () => {
    const settings = new FakeSettingsRepository({
      ...defaultSettings(),
      transcription: { ...defaultSettings().transcription, modelPath: '/gone/whisper.bin' }
    })

    const status = await new GetModelStatus(settings, new FakeModelStore()).execute()

    expect(status.find((s) => s.id === 'transcription-model')?.installed).toBe(false)
  })

  it('Core ML エンコーダは設定を持たないので、常に既定の保存場所を見る', async () => {
    const store = new FakeModelStore()
    store.present.add('/models/ggml-large-v3-turbo-encoder.mlmodelc/weights/weight.bin')

    const status = await new GetModelStatus(
      new FakeSettingsRepository(defaultSettings()),
      store
    ).execute()
    const encoder = status.find((s) => s.id === 'transcription-coreml-encoder')

    expect(encoder?.installed).toBe(true)
    expect(encoder?.path).toBeUndefined()
  })

  it('設定が空でも既定の保存場所にあればインストール済みとする', async () => {
    const store = new FakeModelStore()
    store.present.add('/models/ggml-large-v3-turbo-q5_0.bin')

    const status = await new GetModelStatus(
      new FakeSettingsRepository(defaultSettings()),
      store
    ).execute()

    expect(status.find((s) => s.id === 'transcription-model')?.installed).toBe(true)
  })
})

describe('GetModelStatus（更新の有無）', () => {
  const summarization = findAsset('summarization-model')
  const statusOf = async (store: FakeModelStore, settings = defaultSettings()) =>
    (await new GetModelStatus(new FakeSettingsRepository(settings), store).execute()).find(
      (s) => s.id === 'summarization-model'
    )

  it('手元のファイルがカタログと違えば更新ありとする', async () => {
    const store = new FakeModelStore()
    store.present.add('/models/gemma-4-E4B_q4_0-it.gguf')
    store.digests.set('/models/gemma-4-E4B_q4_0-it.gguf', 'old-digest')

    expect((await statusOf(store))?.updateAvailable).toBe(true)
  })

  it('カタログと一致していれば更新なしとする', async () => {
    const store = new FakeModelStore()
    store.present.add('/models/gemma-4-E4B_q4_0-it.gguf')
    store.digests.set('/models/gemma-4-E4B_q4_0-it.gguf', summarization?.sha256 ?? '')

    expect((await statusOf(store))?.updateAvailable).toBe(false)
  })

  it('中身が分からないファイルは更新ありにしない', async () => {
    // 利用者が自分で選んだ外部ファイルや、確かめようのないものを古いと決めつけない。
    const store = new FakeModelStore()
    store.present.add('/models/gemma-4-E4B_q4_0-it.gguf')

    expect((await statusOf(store))?.updateAvailable).toBe(false)
  })

  it('設定が指す古い名前のファイルも比べる', async () => {
    // 保存名が変わったカタログでは、既定の場所ではなく設定が指すファイルが使われている。
    const store = new FakeModelStore()
    store.present.add('/models/gemma-old.gguf')
    store.digests.set('/models/gemma-old.gguf', 'old-digest')
    const settings = {
      ...defaultSettings(),
      summarization: { ...defaultSettings().summarization, modelPath: '/models/gemma-old.gguf' }
    }

    expect((await statusOf(store, settings))?.updateAvailable).toBe(true)
  })

  it('更新を確かめないときはファイルの中身に触れない', async () => {
    // 取得済みかだけを知りたい呼び出し（チャットの可否など）に、初回のハッシュ計算を待たせない。
    const store = new FakeModelStore()
    store.present.add('/models/gemma-4-E4B_q4_0-it.gguf')
    let asked = false
    store.installedDigest = async () => {
      asked = true
      return 'old-digest'
    }

    const status = await new GetModelStatus(
      new FakeSettingsRepository(defaultSettings()),
      store
    ).execute({ checkUpdates: false })

    expect(asked).toBe(false)
    expect(status.find((s) => s.id === 'summarization-model')?.updateAvailable).toBe(false)
  })

  it('未取得のモデルは更新ありにしない', async () => {
    const store = new FakeModelStore()
    store.digests.set('/models/gemma-4-E4B_q4_0-it.gguf', 'old-digest')

    expect((await statusOf(store))?.updateAvailable).toBe(false)
  })
})

describe('DownloadModel', () => {
  it('取得したパスを設定へ書き込む', async () => {
    const settings = new FakeSettingsRepository(defaultSettings())
    const store = new FakeModelStore()

    const updated = await new DownloadModel(settings, store).execute({
      id: 'summarization-model'
    })

    expect(store.fetched).toEqual(['summarization-model'])
    expect(updated.summarization.modelPath).toBe('/models/gemma-4-E4B_q4_0-it.gguf')
  })

  it('話者識別モデルは diarization の設定へ入る', async () => {
    const settings = new FakeSettingsRepository(defaultSettings())

    const updated = await new DownloadModel(settings, new FakeModelStore()).execute({
      id: 'diarization-embedding'
    })

    expect(updated.diarization.embeddingModelPath).toContain('3dspeaker')
  })

  it('意味検索モデルは search の設定へ入る', async () => {
    const settings = new FakeSettingsRepository(defaultSettings())

    const updated = await new DownloadModel(settings, new FakeModelStore()).execute({
      id: 'search-model'
    })

    expect(updated.search.modelPath).toBe('/models/bge-m3-q8_0.gguf')
  })

  it('進捗を呼び出し側へ渡す', async () => {
    const progress: [number, number | undefined][] = []

    await new DownloadModel(new FakeSettingsRepository(defaultSettings()), new FakeModelStore()).execute({
      id: 'transcription-model',
      onProgress: (received, total) => progress.push([received, total])
    })

    expect(progress).toEqual([[574_041_195, 574_041_195]])
  })

  it('未知の ID は拒否する', async () => {
    await expect(
      new DownloadModel(new FakeSettingsRepository(), new FakeModelStore()).execute({ id: 'nope' })
    ).rejects.toThrow('不明なモデルです: nope')
  })

  it('取得に失敗したら設定を書き換えない', async () => {
    const settings = new FakeSettingsRepository(defaultSettings())
    const store = new FakeModelStore()
    store.failWith = new Error('通信に失敗しました')

    await expect(
      new DownloadModel(settings, store).execute({ id: 'summarization-model' })
    ).rejects.toThrow('通信に失敗しました')
    expect((await settings.load()).summarization.modelPath).toBe('')
  })
})

describe('CancelModelDownload', () => {
  it('指定したモデルの取得を止める', () => {
    const store = new FakeModelStore()
    new CancelModelDownload(store).execute('summarization-model')

    expect(store.cancelled).toEqual(['summarization-model'])
  })

  it('未知の ID は無視する', () => {
    const store = new FakeModelStore()
    new CancelModelDownload(store).execute('nope')

    expect(store.cancelled).toEqual([])
  })
})


/** 保存済みの録音を 1 件だけ作る。状態の違いだけを見たいので中身は最小にする。 */
const recordingWith = (params: {
  status: Recording['status']
  steps?: StepStates
}): Recording => ({
  id: 'rec-1',
  title: '会議',
  startedAt: new Date('2026-09-07T10:00:00+09:00'),
  durationMs: 60_000,
  status: params.status,
  steps: params.steps ?? initialStepStates(),
  slug: '2026-09-07_1000-rec-1'
})

const doneSteps = (): StepStates =>
  ['mix', 'transcribe', 'diarize', 'summarize', 'encode'].reduce<StepStates>(
    (steps, step) => succeedStep(steps, step as 'mix'),
    initialStepStates()
  )

describe('DeleteModel', () => {
  const deleter = (
    settings: FakeSettingsRepository,
    store: FakeModelStore,
    recordings = new FakeRecordingRepository()
  ): DeleteModel => new DeleteModel(settings, store, recordings)

  it('管理下のファイルを消し、設定の参照も外す', async () => {
    const store = new FakeModelStore()
    store.present.add('/models/gemma-4-E4B_q4_0-it.gguf')

    const base = defaultSettings()
    const settings = new FakeSettingsRepository({
      ...base,
      summarization: { ...base.summarization, modelPath: '/models/gemma-4-E4B_q4_0-it.gguf' }
    })

    const updated = await deleter(settings, store).execute('summarization-model')

    expect(store.removed).toEqual(['summarization-model'])
    expect(updated.summarization.modelPath).toBe('')
  })

  it('意味検索モデルを消すと search の参照も外れる', async () => {
    const store = new FakeModelStore()
    store.present.add('/models/bge-m3-q8_0.gguf')
    const base = defaultSettings()
    const settings = new FakeSettingsRepository({
      ...base,
      search: { enabled: true, modelPath: '/models/bge-m3-q8_0.gguf' }
    })

    const updated = await deleter(settings, store).execute('search-model')

    expect(store.removed).toEqual(['search-model'])
    expect(updated.search.modelPath).toBe('')
  })

  it('自分で選んだ外部ファイルは消さず、参照だけ外す', async () => {
    const store = new FakeModelStore()
    store.present.add('/custom/whisper.bin')

    const base = defaultSettings()
    const settings = new FakeSettingsRepository({
      ...base,
      transcription: { ...base.transcription, modelPath: '/custom/whisper.bin' }
    })

    const updated = await deleter(settings, store).execute('transcription-model')

    expect(store.present.has('/custom/whisper.bin')).toBe(true)
    expect(updated.transcription.modelPath).toBe('')
  })

  it('設定が空でも管理下に残ったファイルは消す', async () => {
    const store = new FakeModelStore()
    store.present.add('/models/ggml-large-v3-turbo-q5_0.bin')

    await deleter(new FakeSettingsRepository(defaultSettings()), store).execute(
      'transcription-model'
    )

    expect(store.present.has('/models/ggml-large-v3-turbo-q5_0.bin')).toBe(false)
  })

  it('録音中は削除しない', async () => {
    const store = new FakeModelStore()
    const recordings = new FakeRecordingRepository()
    await recordings.save(recordingWith({ status: 'recording' }))

    await expect(
      deleter(new FakeSettingsRepository(defaultSettings()), store, recordings).execute(
        'summarization-model'
      )
    ).rejects.toThrow('録音中')
    expect(store.removed).toEqual([])
  })

  it('パイプラインの実行中は削除しない', async () => {
    const store = new FakeModelStore()
    const recordings = new FakeRecordingRepository()
    await recordings.save(
      recordingWith({
        status: 'processing',
        steps: startStep(initialStepStates(), 'transcribe')
      })
    )

    await expect(
      deleter(new FakeSettingsRepository(defaultSettings()), store, recordings).execute(
        'transcription-model'
      )
    ).rejects.toThrow('処理中')
    expect(store.removed).toEqual([])
  })

  it('動いていない録音が残っていても削除できる', async () => {
    const store = new FakeModelStore()
    const recordings = new FakeRecordingRepository()
    await recordings.save(recordingWith({ status: 'ready', steps: doneSteps() }))
    // リトライ待ちで pending が残る録音も「実行中」とは見なさない。
    await recordings.save({
      ...recordingWith({ status: 'processing' }),
      id: 'rec-2'
    })

    await deleter(new FakeSettingsRepository(defaultSettings()), store, recordings).execute(
      'summarization-model'
    )

    expect(store.removed).toEqual(['summarization-model'])
  })

  it('未知の ID は拒否する', async () => {
    await expect(
      deleter(new FakeSettingsRepository(), new FakeModelStore()).execute('nope')
    ).rejects.toThrow('不明なモデルです: nope')
  })
})

describe('UpdateModel', () => {
  const updater = (
    settings: FakeSettingsRepository,
    store: FakeModelStore,
    recordings = new FakeRecordingRepository()
  ): UpdateModel => new UpdateModel(settings, store, recordings)

  it('取り直したファイルを設定に書き込み、古い名前の参照を置き換える', async () => {
    const store = new FakeModelStore()
    store.present.add('/models/gemma-old.gguf')
    const settings = new FakeSettingsRepository({
      ...defaultSettings(),
      summarization: { ...defaultSettings().summarization, modelPath: '/models/gemma-old.gguf' }
    })

    const saved = await updater(settings, store).execute({ id: 'summarization-model' })

    expect(store.fetched).toEqual(['summarization-model'])
    expect(saved.summarization.modelPath).toBe('/models/gemma-4-E4B_q4_0-it.gguf')
  })

  it('録音中は更新しない', async () => {
    const store = new FakeModelStore()
    const recordings = new FakeRecordingRepository()
    await recordings.save(recordingWith({ status: 'recording' }))

    await expect(
      updater(new FakeSettingsRepository(defaultSettings()), store, recordings).execute({
        id: 'summarization-model'
      })
    ).rejects.toThrow('録音中はモデルを更新できません')
    expect(store.fetched).toEqual([])
  })

  it('パイプラインの実行中は更新しない', async () => {
    const store = new FakeModelStore()
    const recordings = new FakeRecordingRepository()
    await recordings.save(
      recordingWith({
        status: 'processing',
        steps: startStep(initialStepStates(), 'transcribe')
      })
    )

    await expect(
      updater(new FakeSettingsRepository(defaultSettings()), store, recordings).execute({
        id: 'transcription-model'
      })
    ).rejects.toThrow('処理中の録音があるためモデルを更新できません')
    expect(store.fetched).toEqual([])
  })

  it('未知の ID は拒否する', async () => {
    await expect(
      updater(new FakeSettingsRepository(), new FakeModelStore()).execute({ id: 'nope' })
    ).rejects.toThrow('不明なモデルです: nope')
  })
})
