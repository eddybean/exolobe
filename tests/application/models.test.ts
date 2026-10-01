import { describe, expect, it } from 'vitest'
import {
  CancelModelDownload,
  DeleteModel,
  DownloadModel,
  GetModelStatus,
  UpdateModel,
  type ModelStorePort
} from '@application/usecases/models'
import {
  MANAGED_ASSETS,
  MODEL_PACKAGES,
  findAsset,
  findPackage,
  formatBytes,
  modelPackagesFor,
  requiredAssets
} from '@domain/ModelCatalog'
import type { ManagedAsset, ManagedAssetId } from '@domain/ModelCatalog'
import { initialStepStates, startStep, succeedStep, type Recording, type StepStates } from '@domain/Recording'
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
    expect(requiredAssets().map((a) => a.id)).toEqual(['transcription-model', 'vad-model', 'summarization-model'])
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
    expect(encoder?.entryPath).toBe('ggml-large-v3-turbo-encoder.mlmodelc/weights/weight.bin')
  })

  it('Core ML エンコーダは任意にする。無くても文字起こしは動く', () => {
    expect(findAsset('transcription-coreml-encoder')?.optional).toBe(true)
  })

  it('どのファイルもちょうど 1 つのパッケージに属する', () => {
    const ids = MODEL_PACKAGES.flatMap((pkg) => pkg.assets.map((asset) => asset.id))

    expect([...ids].sort()).toEqual(MANAGED_ASSETS.map((asset) => asset.id).sort())
  })

  it('話者識別は分割と埋め込みの 2 ファイルを 1 つのモデルとして扱う', () => {
    // どちらか片方だけでは話者識別も声紋の取り出しも動かない。
    const diarization = findPackage('diarization')

    expect(diarization?.assets.map((asset) => asset.id)).toEqual(['diarization-segmentation', 'diarization-embedding'])
    expect(diarization?.optional).toBe(true)
    expect(diarization?.bytes).toBe(6_958_444 + 28_281_164)
    expect(findPackage('diarization-embedding')).toBeUndefined()
  })
})

describe('modelPackagesFor', () => {
  it('Core ML が使えれば、Core ML のエンコーダも並べる', () => {
    expect(modelPackagesFor({ coreMl: true }).map((pkg) => pkg.id)).toContain('transcription-coreml-encoder')
  })

  it('Core ML が使えない OS（Windows）では、Core ML のエンコーダを並べない', () => {
    const ids = modelPackagesFor({ coreMl: false }).map((pkg) => pkg.id)

    expect(ids).not.toContain('transcription-coreml-encoder')
    expect(ids).toContain('transcription-model')
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
    const status = await new GetModelStatus(new FakeSettingsRepository(defaultSettings('ja')), store).execute()

    expect(status).toHaveLength(MODEL_PACKAGES.length)
    expect(status.every((s) => !s.installed)).toBe(true)
    expect(status[0]?.path).toBeUndefined()
  })

  it('設定されたパスが実在すればインストール済みとする', async () => {
    const store = new FakeModelStore()
    store.present.add('/custom/whisper.bin')

    const settings = new FakeSettingsRepository({
      ...defaultSettings('ja'),
      transcription: { ...defaultSettings('ja').transcription, modelPath: '/custom/whisper.bin' }
    })

    const status = await new GetModelStatus(settings, store).execute()
    const transcription = status.find((s) => s.id === 'transcription-model')

    expect(transcription?.installed).toBe(true)
    expect(transcription?.path).toBe('/custom/whisper.bin')
  })

  it('設定されたパスのファイルが消えていれば未インストールに戻す', async () => {
    const settings = new FakeSettingsRepository({
      ...defaultSettings('ja'),
      transcription: { ...defaultSettings('ja').transcription, modelPath: '/gone/whisper.bin' }
    })

    const status = await new GetModelStatus(settings, new FakeModelStore()).execute()

    expect(status.find((s) => s.id === 'transcription-model')?.installed).toBe(false)
  })

  it('Core ML エンコーダは設定を持たないので、常に既定の保存場所を見る', async () => {
    const store = new FakeModelStore()
    store.present.add('/models/ggml-large-v3-turbo-encoder.mlmodelc/weights/weight.bin')

    const status = await new GetModelStatus(new FakeSettingsRepository(defaultSettings('ja')), store).execute()
    const encoder = status.find((s) => s.id === 'transcription-coreml-encoder')

    expect(encoder?.installed).toBe(true)
    expect(encoder?.path).toBeUndefined()
  })

  it('設定が空でも既定の保存場所にあればインストール済みとする', async () => {
    const store = new FakeModelStore()
    store.present.add('/models/ggml-large-v3-turbo-q5_0.bin')

    const status = await new GetModelStatus(new FakeSettingsRepository(defaultSettings('ja')), store).execute()

    expect(status.find((s) => s.id === 'transcription-model')?.installed).toBe(true)
  })

  it('話者識別は 2 ファイルが揃って初めて取得済みとする', async () => {
    const store = new FakeModelStore()
    store.present.add('/models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx')
    const statusOf = async () =>
      (await new GetModelStatus(new FakeSettingsRepository(defaultSettings('ja')), store).execute()).find(
        (s) => s.id === 'diarization'
      )

    expect((await statusOf())?.installed).toBe(false)

    store.present.add('/models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx')
    const status = await statusOf()
    expect(status?.installed).toBe(true)
    expect(status?.bytes).toBe(6_958_444 + 28_281_164)
  })

  it('話者識別はどちらか片方が古ければ更新ありとする', async () => {
    const store = new FakeModelStore()
    const embedding = '/models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx'
    store.present.add('/models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx')
    store.present.add(embedding)
    store.digests.set(embedding, 'old-digest')

    const status = await new GetModelStatus(new FakeSettingsRepository(defaultSettings('ja')), store).execute()

    expect(status.find((s) => s.id === 'diarization')?.updateAvailable).toBe(true)
  })
})

describe('GetModelStatus（OS で使えるもの）', () => {
  it('渡されたパッケージだけを返す', async () => {
    const packages = modelPackagesFor({ coreMl: false })
    const status = await new GetModelStatus(
      new FakeSettingsRepository(defaultSettings('ja')),
      new FakeModelStore(),
      packages
    ).execute()

    expect(status.map((s) => s.id)).toEqual(packages.map((pkg) => pkg.id))
  })
})

describe('DownloadModel（OS で使えるもの）', () => {
  it('この OS で使えないパッケージは取得しない', async () => {
    const store = new FakeModelStore()
    const download = new DownloadModel(
      new FakeSettingsRepository(defaultSettings('ja')),
      store,
      modelPackagesFor({ coreMl: false })
    )

    await expect(download.execute({ id: 'transcription-coreml-encoder' })).rejects.toThrow()
    expect(store.fetched).toEqual([])
  })
})

describe('GetModelStatus（更新の有無）', () => {
  const summarization = findAsset('summarization-model')
  const statusOf = async (store: FakeModelStore, settings = defaultSettings('ja')) =>
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
      ...defaultSettings('ja'),
      summarization: { ...defaultSettings('ja').summarization, modelPath: '/models/gemma-old.gguf' }
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

    const status = await new GetModelStatus(new FakeSettingsRepository(defaultSettings('ja')), store).execute({
      checkUpdates: false
    })

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
    const settings = new FakeSettingsRepository(defaultSettings('ja'))
    const store = new FakeModelStore()

    const updated = await new DownloadModel(settings, store).execute({
      id: 'summarization-model'
    })

    expect(store.fetched).toEqual(['summarization-model'])
    expect(updated.summarization.modelPath).toBe('/models/gemma-4-E4B_q4_0-it.gguf')
  })

  it('話者識別は 2 ファイルとも取得し、diarization の設定へ両方を書き込む', async () => {
    const settings = new FakeSettingsRepository(defaultSettings('ja'))
    const store = new FakeModelStore()

    const updated = await new DownloadModel(settings, store).execute({ id: 'diarization' })

    expect(store.fetched).toEqual(['diarization-segmentation', 'diarization-embedding'])
    expect(updated.diarization.segmentationModelPath).toBe('/models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx')
    expect(updated.diarization.embeddingModelPath).toContain('3dspeaker')
  })

  it('複数ファイルの進捗はまとめて 1 本のバーになるよう積み上げる', async () => {
    const progress: [number, number | undefined][] = []

    await new DownloadModel(new FakeSettingsRepository(defaultSettings('ja')), new FakeModelStore()).execute({
      id: 'diarization',
      onProgress: (received, total) => progress.push([received, total])
    })

    const total = 6_958_444 + 28_281_164
    expect(progress).toEqual([
      [6_958_444, total],
      [total, total]
    ])
  })

  it('2 つ目の取得に失敗したら設定を書き換えない', async () => {
    // 片方だけ設定に入っても使えないので、揃うまでは書き込まない。
    const settings = new FakeSettingsRepository(defaultSettings('ja'))
    const store = new FakeModelStore()
    const fetch = store.fetch.bind(store)
    store.fetch = async (asset, options) => {
      if (asset.id === 'diarization-embedding') throw new Error('通信に失敗しました')
      return fetch(asset, options)
    }

    await expect(new DownloadModel(settings, store).execute({ id: 'diarization' })).rejects.toThrow(
      '通信に失敗しました'
    )
    expect((await settings.load()).diarization.segmentationModelPath).toBe('')
  })

  it('意味検索モデルは search の設定へ入る', async () => {
    const settings = new FakeSettingsRepository(defaultSettings('ja'))

    const updated = await new DownloadModel(settings, new FakeModelStore()).execute({
      id: 'search-model'
    })

    expect(updated.search.modelPath).toBe('/models/bge-m3-q8_0.gguf')
  })

  it('進捗を呼び出し側へ渡す', async () => {
    const progress: [number, number | undefined][] = []

    await new DownloadModel(new FakeSettingsRepository(defaultSettings('ja')), new FakeModelStore()).execute({
      id: 'transcription-model',
      onProgress: (received, total) => progress.push([received, total])
    })

    expect(progress).toEqual([[574_041_195, 574_041_195]])
  })

  it('未知の ID は拒否する', async () => {
    await expect(
      new DownloadModel(new FakeSettingsRepository(), new FakeModelStore()).execute({ id: 'nope' })
    ).rejects.toThrow('unknownModel')
  })

  it('取得に失敗したら設定を書き換えない', async () => {
    const settings = new FakeSettingsRepository(defaultSettings('ja'))
    const store = new FakeModelStore()
    store.failWith = new Error('通信に失敗しました')

    await expect(new DownloadModel(settings, store).execute({ id: 'summarization-model' })).rejects.toThrow(
      '通信に失敗しました'
    )
    expect((await settings.load()).summarization.modelPath).toBe('')
  })
})

describe('CancelModelDownload', () => {
  it('指定したモデルの取得を止める', () => {
    const store = new FakeModelStore()
    new CancelModelDownload(store).execute('summarization-model')

    expect(store.cancelled).toEqual(['summarization-model'])
  })

  it('話者識別は 2 ファイルとも止める', () => {
    const store = new FakeModelStore()
    new CancelModelDownload(store).execute('diarization')

    expect(store.cancelled).toEqual(['diarization-segmentation', 'diarization-embedding'])
  })

  it('未知の ID は無視する', () => {
    const store = new FakeModelStore()
    new CancelModelDownload(store).execute('nope')

    expect(store.cancelled).toEqual([])
  })
})

/** 保存済みの録音を 1 件だけ作る。状態の違いだけを見たいので中身は最小にする。 */
const recordingWith = (params: { status: Recording['status']; steps?: StepStates }): Recording => ({
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

    const base = defaultSettings('ja')
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
    const base = defaultSettings('ja')
    const settings = new FakeSettingsRepository({
      ...base,
      search: { enabled: true, modelPath: '/models/bge-m3-q8_0.gguf' }
    })

    const updated = await deleter(settings, store).execute('search-model')

    expect(store.removed).toEqual(['search-model'])
    expect(updated.search.modelPath).toBe('')
  })

  it('話者識別は 2 ファイルとも消し、両方の参照を外す', async () => {
    const store = new FakeModelStore()
    const base = defaultSettings('ja')
    const settings = new FakeSettingsRepository({
      ...base,
      diarization: {
        ...base.diarization,
        segmentationModelPath: '/models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx',
        embeddingModelPath: '/models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx'
      }
    })

    const updated = await deleter(settings, store).execute('diarization')

    expect(store.removed).toEqual(['diarization-segmentation', 'diarization-embedding'])
    expect(updated.diarization.segmentationModelPath).toBe('')
    expect(updated.diarization.embeddingModelPath).toBe('')
  })

  it('自分で選んだ外部ファイルは消さず、参照だけ外す', async () => {
    const store = new FakeModelStore()
    store.present.add('/custom/whisper.bin')

    const base = defaultSettings('ja')
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

    await deleter(new FakeSettingsRepository(defaultSettings('ja')), store).execute('transcription-model')

    expect(store.present.has('/models/ggml-large-v3-turbo-q5_0.bin')).toBe(false)
  })

  it('録音中は削除しない', async () => {
    const store = new FakeModelStore()
    const recordings = new FakeRecordingRepository()
    await recordings.save(recordingWith({ status: 'recording' }))

    await expect(
      deleter(new FakeSettingsRepository(defaultSettings('ja')), store, recordings).execute('summarization-model')
    ).rejects.toThrow('modelBusyRecording')
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
      deleter(new FakeSettingsRepository(defaultSettings('ja')), store, recordings).execute('transcription-model')
    ).rejects.toThrow('modelBusyProcessing')
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

    await deleter(new FakeSettingsRepository(defaultSettings('ja')), store, recordings).execute('summarization-model')

    expect(store.removed).toEqual(['summarization-model'])
  })

  it('未知の ID は拒否する', async () => {
    await expect(deleter(new FakeSettingsRepository(), new FakeModelStore()).execute('nope')).rejects.toThrow(
      'unknownModel'
    )
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
      ...defaultSettings('ja'),
      summarization: { ...defaultSettings('ja').summarization, modelPath: '/models/gemma-old.gguf' }
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
      updater(new FakeSettingsRepository(defaultSettings('ja')), store, recordings).execute({
        id: 'summarization-model'
      })
    ).rejects.toThrow('modelBusyRecording')
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
      updater(new FakeSettingsRepository(defaultSettings('ja')), store, recordings).execute({
        id: 'transcription-model'
      })
    ).rejects.toThrow('modelBusyProcessing')
    expect(store.fetched).toEqual([])
  })

  it('未知の ID は拒否する', async () => {
    await expect(updater(new FakeSettingsRepository(), new FakeModelStore()).execute({ id: 'nope' })).rejects.toThrow(
      'unknownModel'
    )
  })
})
