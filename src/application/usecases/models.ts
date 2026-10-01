import type { RecordingRepositoryPort, SettingsRepositoryPort } from '@application/ports'
import {
  MODEL_PACKAGES,
  findPackage,
  type ManagedAsset,
  type ManagedAssetId,
  type ModelPackage
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
  /** ModelPackage の ID。取得・削除などの操作はこの単位で行う。 */
  readonly id: string
  readonly bytes: number
  readonly optional: boolean
  readonly installed: boolean
  /** 手元のファイルが、このアプリの版が想定する配布物と違う。 */
  readonly updateAvailable: boolean
  /** 設定が指しているパス。未設定、または複数ファイルから成るものは undefined。 */
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
    private readonly store: ModelStorePort,
    /** この環境で使えるもの（modelPackagesFor）。 */
    private readonly packages: readonly ModelPackage[] = MODEL_PACKAGES
  ) {}

  /**
   * checkUpdates を切るのは、取得済みかだけを知りたい呼び出しのため。更新の確認は
   * 初回に数 GB のハッシュ計算を伴うので、モデル一覧の画面以外には待たせない。
   */
  async execute(options: { checkUpdates: boolean } = { checkUpdates: true }): Promise<ManagedAssetStatus[]> {
    const settings = await this.settings.load()

    return Promise.all(
      this.packages.map(async (pkg) => {
        const files = pkg.assets.map((asset) => {
          const configured = configuredPath(settings, asset.id)
          return { asset, configured, path: configured || this.store.pathFor(asset) }
        })
        // 1 つでも欠けていれば使えないので、全部揃って初めて取得済みとする。
        const installed = (await Promise.all(files.map((file) => this.store.exists(file.path)))).every(Boolean)
        const outdated =
          options.checkUpdates &&
          installed &&
          (await Promise.all(files.map((file) => this.isOutdated(file.asset, file.path)))).some(Boolean)

        return {
          id: pkg.id,
          bytes: pkg.bytes,
          optional: pkg.optional,
          installed,
          updateAvailable: outdated,
          path: files.length === 1 ? files[0]?.configured || undefined : undefined
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
 *
 * 複数ファイルから成るものは、全部揃ってから設定へ書く。片方だけ設定に入っても
 * 使えず、取得済みのように見えるだけになるため（取れたファイルは手元に残るので、
 * やり直しでは取り直さない）。
 */
export class DownloadModel {
  constructor(
    private readonly settings: SettingsRepositoryPort,
    private readonly store: ModelStorePort,
    /** この環境で使えるもの（modelPackagesFor）。ここに無いものは知らないモデルとして断る。 */
    private readonly packages: readonly ModelPackage[] = MODEL_PACKAGES
  ) {}

  async execute(params: {
    id: string
    onProgress?: (received: number, total: number | undefined) => void
  }): Promise<Settings> {
    const pkg = packageOf(params.id, this.packages)
    const { onProgress } = params

    const fetched: { asset: ManagedAsset; path: string }[] = []
    // 画面には 1 本のバーで見せるので、先に済んだファイルの分を積み上げて渡す。
    let done = 0
    for (const asset of pkg.assets) {
      const offset = done
      const path = await this.store.fetch(asset, {
        ...(onProgress === undefined
          ? {}
          : {
              onProgress: (received: number, total: number | undefined) =>
                onProgress(offset + received, pkg.assets.length === 1 ? total : pkg.bytes)
            })
      })
      fetched.push({ asset, path })
      done += asset.bytes
    }

    let saved = await this.settings.load()
    for (const { asset, path } of fetched) {
      saved = await this.settings.save(asset.applyTo(path))
    }
    return saved
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
    const pkg = packageOf(id)

    await ensureModelsIdle(this.recordings, 'delete')

    for (const asset of pkg.assets) {
      await this.store.remove(asset)
    }

    let settings = await this.settings.load()
    for (const asset of pkg.assets) {
      // 参照が既に空なら書き込まない。無用な settings.json の更新を避ける。
      if (!configuredPath(settings, asset.id)) continue
      settings = await this.settings.save(asset.applyTo(''))
    }
    return settings
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
    private readonly recordings: RecordingRepositoryPort,
    /** この環境で使えるもの（modelPackagesFor）。 */
    private readonly packages: readonly ModelPackage[] = MODEL_PACKAGES
  ) {}

  async execute(params: {
    id: string
    onProgress?: (received: number, total: number | undefined) => void
  }): Promise<Settings> {
    packageOf(params.id, this.packages)

    await ensureModelsIdle(this.recordings, 'update')

    return new DownloadModel(this.settings, this.store, this.packages).execute(params)
  }
}

/**
 * 読み込み中のモデルを消したり入れ替えたりするとジョブが途中で失敗するため、
 * 動いている間は断る。pending が残るだけの録音（リトライ待ち）は動いていないので妨げない。
 */
const ensureModelsIdle = async (recordings: RecordingRepositoryPort, action: 'delete' | 'update'): Promise<void> => {
  const list = await recordings.list()

  if (list.some((recording) => recording.status === 'recording')) {
    throw new ModelInUseError({ code: 'modelBusyRecording', action })
  }
  if (list.some((recording) => isProcessing(recording.steps))) {
    throw new ModelInUseError({ code: 'modelBusyProcessing', action })
  }
}

export class CancelModelDownload {
  constructor(private readonly store: ModelStorePort) {}

  execute(id: string): void {
    for (const asset of findPackage(id)?.assets ?? []) {
      this.store.cancel(asset.id)
    }
  }
}

const packageOf = (id: string, packages: readonly ModelPackage[] = MODEL_PACKAGES): ModelPackage => {
  const pkg = packages.find((candidate) => candidate.id === id)
  if (!pkg) throw new ConfigurationError({ code: 'unknownModel', id })
  return pkg
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
