import type { RecordingRepositoryPort, SettingsRepositoryPort } from '@application/ports'
import {
  MANAGED_ASSETS,
  findAsset,
  type ManagedAsset,
  type ManagedAssetId
} from '@domain/ModelCatalog'
import { ConfigurationError, ModelInUseError } from '@domain/errors'
import { isProcessing } from '@domain/Recording'
import type { Settings } from '@domain/Settings'

/** モデルファイルの置き場所と存在確認。 */
export interface ModelStorePort {
  /** 展開後・保存後に実際に使われるファイルの絶対パス。 */
  pathFor(asset: ManagedAsset): string
  exists(path: string): Promise<boolean>
  /**
   * 手元のファイルがどの配布物から来たか（配布物の sha256）。アプリが取得したと
   * 確かめられないもの（利用者が選んだ外部ファイルなど）は undefined。
   */
  installedDigest(asset: ManagedAsset, path: string): Promise<string | undefined>
  /** ダウンロードして（必要なら展開して）、使えるファイルのパスを返す。 */
  fetch(
    asset: ManagedAsset,
    options: { onProgress?: (received: number, total: number | undefined) => void }
  ): Promise<string>
  /** 進行中のダウンロードを止める。 */
  cancel(id: ManagedAssetId): void
  /** 管理下に置いたファイルを消す。無ければ何もしない。 */
  remove(asset: ManagedAsset): Promise<void>
}

export interface ManagedAssetStatus {
  readonly id: ManagedAssetId
  readonly label: string
  readonly description: string
  readonly bytes: number
  readonly optional: boolean
  readonly installed: boolean
  /** 手元のファイルが、このアプリの版が想定する配布物と違う。 */
  readonly updateAvailable: boolean
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

  /**
   * checkUpdates を切るのは、取得済みかだけを知りたい呼び出しのため。更新の確認は
   * 初回に数 GB のハッシュ計算を伴うので、モデル一覧の画面以外には待たせない。
   */
  async execute(
    options: { checkUpdates: boolean } = { checkUpdates: true }
  ): Promise<ManagedAssetStatus[]> {
    const settings = await this.settings.load()

    return Promise.all(
      MANAGED_ASSETS.map(async (asset) => {
        const configured = configuredPath(settings, asset.id)
        const path = configured || this.store.pathFor(asset)
        const installed = await this.store.exists(path)

        return {
          id: asset.id,
          label: asset.label,
          description: asset.description,
          bytes: asset.bytes,
          optional: asset.optional,
          installed,
          updateAvailable:
            options.checkUpdates && installed && (await this.isOutdated(asset, path)),
          path: configured || undefined
        }
      })
    )
  }

  /**
   * 比べる相手は上流ではなくカタログ。上流の差し替えをそのまま採ると、評価を
   * 経ていないモデルで文字起こしや要約の質が変わるため。中身が分からないものは
   * 古いと決めつけない。
   */
  private async isOutdated(asset: ManagedAsset, path: string): Promise<boolean> {
    if (asset.sha256 === undefined) return false
    const digest = await this.store.installedDigest(asset, path)
    return digest !== undefined && digest !== asset.sha256
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

/**
 * モデルを 1 つ削除し、設定の参照も外す。
 *
 * 消すのはアプリが models ディレクトリに置いたファイルだけ。設定が利用者の
 * 選んだ外部パスを指している場合、そのファイルは他の用途で共有されている
 * かもしれないので触らず、参照だけを外す。
 *
 * 管理下のファイルは設定の内容に関わらず消す。残しておくと GetModelStatus が
 * 既定の保存場所を見て「取得済み」を返し続け、削除したのに消えていないように
 * 見えるため。
 */
export class DeleteModel {
  constructor(
    private readonly settings: SettingsRepositoryPort,
    private readonly store: ModelStorePort,
    private readonly recordings: RecordingRepositoryPort
  ) {}

  async execute(id: string): Promise<Settings> {
    const asset = findAsset(id)
    if (!asset) {
      throw new ConfigurationError(`不明なモデルです: ${id}`)
    }

    await ensureModelsIdle(this.recordings, '削除')

    await this.store.remove(asset)

    const settings = await this.settings.load()
    // 参照が既に空なら書き込まない。無用な settings.json の更新を避ける。
    if (!configuredPath(settings, asset.id)) return settings

    return this.settings.save(asset.applyTo(''))
  }
}

/**
 * カタログと違うファイルを、今の版が想定する配布物に取り替える。
 *
 * 取得そのものは DownloadModel と同じで、差し替えと古いファイルの片付けは
 * ストアが受け持つ。違いは動いている間に断ること。ワーカーが読み込み中の
 * ファイルを入れ替えると、同じジョブの途中でモデルが変わりうるため。
 */
export class UpdateModel {
  constructor(
    private readonly settings: SettingsRepositoryPort,
    private readonly store: ModelStorePort,
    private readonly recordings: RecordingRepositoryPort
  ) {}

  async execute(params: {
    id: string
    onProgress?: (received: number, total: number | undefined) => void
  }): Promise<Settings> {
    if (!findAsset(params.id)) {
      throw new ConfigurationError(`不明なモデルです: ${params.id}`)
    }

    await ensureModelsIdle(this.recordings, '更新')

    return new DownloadModel(this.settings, this.store).execute(params)
  }
}

/**
 * 読み込み中のモデルを消したり入れ替えたりするとジョブが途中で失敗するため、
 * 動いている間は断る。pending が残るだけの録音（リトライ待ち）は動いていないので妨げない。
 */
const ensureModelsIdle = async (
  recordings: RecordingRepositoryPort,
  action: '削除' | '更新'
): Promise<void> => {
  const list = await recordings.list()

  if (list.some((recording) => recording.status === 'recording')) {
    throw new ModelInUseError(
      `録音中はモデルを${action}できません。録音を停止してから操作してください。`
    )
  }
  if (list.some((recording) => isProcessing(recording.steps))) {
    throw new ModelInUseError(
      `処理中の録音があるためモデルを${action}できません。完了してから操作してください。`
    )
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
    // Core ML エンコーダは whisper.cpp が文字起こしモデルのパスから位置を導くため、
    // 設定に対応する項目が無い。常に既定の保存場所を見ればよい。
    case 'transcription-coreml-encoder':
      return ''
    case 'vad-model':
      return settings.transcription.vadModelPath
    case 'summarization-model':
      return settings.summarization.modelPath
    case 'diarization-segmentation':
      return settings.diarization.segmentationModelPath
    case 'diarization-embedding':
      return settings.diarization.embeddingModelPath
    case 'search-model':
      return settings.search.modelPath
  }
}
