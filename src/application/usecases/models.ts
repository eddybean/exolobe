import type { SettingsRepositoryPort } from '@application/ports'
import {
  MANAGED_ASSETS,
  findAsset,
  type ManagedAsset,
  type ManagedAssetId
} from '@domain/ModelCatalog'
import { ConfigurationError } from '@domain/errors'
import type { Settings } from '@domain/Settings'

/** モデルファイルの置き場所と存在確認。 */
export interface ModelStorePort {
  /** 展開後・保存後に実際に使われるファイルの絶対パス。 */
  pathFor(asset: ManagedAsset): string
  exists(path: string): Promise<boolean>
  /** ダウンロードして（必要なら展開して）、使えるファイルのパスを返す。 */
  fetch(
    asset: ManagedAsset,
    options: { onProgress?: (received: number, total: number | undefined) => void }
  ): Promise<string>
  /** 進行中のダウンロードを止める。 */
  cancel(id: ManagedAssetId): void
}

export interface ManagedAssetStatus {
  readonly id: ManagedAssetId
  readonly label: string
  readonly description: string
  readonly bytes: number
  readonly optional: boolean
  readonly installed: boolean
  /** 設定が指しているパス。未設定なら undefined。 */
  readonly path: string | undefined
}

/**
 * 管理対象ファイルの状況を返す。
 *
 * 「設定に書かれたパスが実在するか」まで見る。モデルを手で消したり外付け
 * ドライブに置いたりした場合に、設定だけが残って実行時に分かりにくいエラーへ
 * なるのを防ぐ。
 */
export class GetModelStatus {
  constructor(
    private readonly settings: SettingsRepositoryPort,
    private readonly store: ModelStorePort
  ) {}

  async execute(): Promise<ManagedAssetStatus[]> {
    const settings = await this.settings.load()

    return Promise.all(
      MANAGED_ASSETS.map(async (asset) => {
        const configured = configuredPath(settings, asset.id)
        const path = configured || this.store.pathFor(asset)

        return {
          id: asset.id,
          label: asset.label,
          description: asset.description,
          bytes: asset.bytes,
          optional: asset.optional,
          installed: await this.store.exists(path),
          path: configured || undefined
        }
      })
    )
  }
}

/**
 * モデルを 1 つ取得し、設定に反映する。
 *
 * ダウンロードが終わった時点で設定へ書き込むので、利用者がパスを手入力する
 * 必要がない。すでに手元にあるファイルは再取得しない。
 */
export class DownloadModel {
  constructor(
    private readonly settings: SettingsRepositoryPort,
    private readonly store: ModelStorePort
  ) {}

  async execute(params: {
    id: string
    onProgress?: (received: number, total: number | undefined) => void
  }): Promise<Settings> {
    const asset = findAsset(params.id)
    if (!asset) {
      throw new ConfigurationError(`不明なモデルです: ${params.id}`)
    }

    const path = await this.store.fetch(asset, {
      ...(params.onProgress === undefined ? {} : { onProgress: params.onProgress })
    })

    return this.settings.save(asset.applyTo(path))
  }
}

export class CancelModelDownload {
  constructor(private readonly store: ModelStorePort) {}

  execute(id: string): void {
    const asset = findAsset(id)
    if (asset) this.store.cancel(asset.id)
  }
}

const configuredPath = (settings: Settings, id: ManagedAssetId): string => {
  switch (id) {
    case 'transcription-model':
      return settings.transcription.modelPath
    case 'vad-model':
      return settings.transcription.vadModelPath
    case 'summarization-model':
      return settings.summarization.modelPath
    case 'diarization-segmentation':
      return settings.diarization.segmentationModelPath
    case 'diarization-embedding':
      return settings.diarization.embeddingModelPath
  }
}
