import { describe, expect, it } from 'vitest'
import {
  CancelModelDownload,
  DeleteModel,
  DownloadModel,
  GetModelStatus,
  type ModelStorePort
} from '@application/usecases/models'
import { MANAGED_ASSETS, formatBytes, requiredAssets } from '@domain/ModelCatalog'
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
  failWith?: Error

  pathFor(asset: ManagedAsset): string {
    return `/models/${asset.entryPath ?? asset.fileName}`
  }
  async exists(path: string): Promise<boolean> {
    return this.present.has(path)
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
      { transcription: { vadModelPath: '/p' } },
      { summarization: { modelPath: '/p' } },
      { diarization: { segmentationModelPath: '/p' } },
      { diarization: { embeddingModelPath: '/p' } }
    ])
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

    expect(status).toHaveLength(5)
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
