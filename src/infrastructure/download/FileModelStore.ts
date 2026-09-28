import { execFile } from 'node:child_process'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { promisify } from 'node:util'
import type { ModelStorePort } from '@application/usecases/models'
import type { ManagedAsset, ManagedAssetId } from '@domain/ModelCatalog'
import { AppError, toMessage } from '@domain/errors'
import { AssetDownloader, hashOf } from './AssetDownloader'
import { ModelManifest } from './ModelManifest'

const execFileAsync = promisify(execFile)

export class ModelStoreError extends AppError {}

/**
 * モデルファイルをアプリの管理下に置く。
 *
 * 保存先はユーザーの録音保存先とは分ける。モデルは会議の成果物ではなく
 * 再取得できるキャッシュなので、録音のディレクトリを膨らませない。
 *
 * どの配布物を置いたかは installed.json に記録する。アプリの更新でカタログが
 * 変わったとき、手元のファイルが古いと気付いて取り替えられるようにするため。
 */
export class FileModelStore implements ModelStorePort {
  private readonly running = new Map<ManagedAssetId, AbortController>()
  private readonly manifest: ModelManifest

  constructor(
    private readonly modelsDir: string,
    private readonly downloader = new AssetDownloader()
  ) {
    this.manifest = new ModelManifest(join(modelsDir, 'installed.json'))
  }

  pathFor(asset: ManagedAsset): string {
    // アーカイブは展開後のファイルを指す。
    return asset.entryPath ? join(this.modelsDir, asset.entryPath) : this.downloadPathFor(asset)
  }

  /** 配布元から落ちてくるファイルそのものの置き場所。 */
  private downloadPathFor(asset: ManagedAsset): string {
    return join(this.modelsDir, asset.fileName)
  }

  async exists(path: string): Promise<boolean> {
    if (!path) return false
    try {
      return (await stat(path)).size > 0
    } catch {
      return false
    }
  }

  /**
   * 記録が無ければ中身から求めて記録する。この仕組みより前に取得したファイルにも、
   * 次にカタログが変わったとき気付けるようにするため（初回だけ数秒かかる）。
   * アーカイブ由来のものは展開後にアーカイブを消しているので、記録が無ければ分からない。
   */
  async installedDigest(asset: ManagedAsset, path: string): Promise<string | undefined> {
    const managed = this.managedPath(path)
    if (managed === undefined) return undefined
    const current = await statOf(path)
    if (!current) return undefined

    const record = await this.manifest.get(asset.id)
    if (
      record?.path === managed &&
      record.size === current.size &&
      record.mtimeMs === current.mtimeMs
    ) {
      return record.sha256
    }
    if (asset.archive) return undefined

    const sha256 = await hashOf(path)
    await this.manifest.set(asset.id, {
      path: managed,
      sha256,
      size: current.size,
      mtimeMs: current.mtimeMs
    })
    return sha256
  }

  /** models ディレクトリからの相対パス。外にあるもの（利用者が選んだファイル）は undefined。 */
  private managedPath(path: string): string | undefined {
    if (!path) return undefined
    const managed = relative(this.modelsDir, path)
    if (!managed || managed.startsWith('..') || isAbsolute(managed)) return undefined
    return managed
  }

  cancel(id: ManagedAssetId): void {
    this.running.get(id)?.abort()
  }

  /**
   * 管理下に置いたファイルを消す。設定が指す外部パスには触れない
   * （利用者が自分で用意したファイルを消してしまわないため）。
   *
   * アーカイブ配布のものは展開先ディレクトリごと消す。model.onnx だけ消しても
   * 同梱の付随ファイルが残り、次の取得で古い残骸と混ざるため。
   * 中断で残った途中までのアーカイブも同時に片付ける。
   */
  async remove(asset: ManagedAsset): Promise<void> {
    const targets = asset.entryPath
      ? [join(this.modelsDir, topLevel(asset.entryPath)), this.downloadPathFor(asset)]
      : [this.downloadPathFor(asset)]
    // カタログの保存名が変わる前に取得したファイルも、同じモデルとして消す。
    const record = await this.manifest.get(asset.id)
    if (record) targets.push(join(this.modelsDir, topLevel(record.path)))

    for (const target of targets) {
      await rm(target, { recursive: true, force: true })
    }
    await this.manifest.set(asset.id, undefined)
  }

  async fetch(
    asset: ManagedAsset,
    options: { onProgress?: (received: number, total: number | undefined) => void }
  ): Promise<string> {
    const finalPath = this.pathFor(asset)
    const replacing = await this.exists(finalPath)
    if (replacing && !(await this.isOutdated(asset, finalPath))) return finalPath

    const previous = await this.manifest.get(asset.id)
    const controller = new AbortController()
    this.running.set(asset.id, controller)

    // アーカイブは一度ダウンロードしてから展開する。取り替えるときは別名で受け取り、
    // 取得に失敗しても手元の古いファイルで動き続けられるようにする。
    const downloadPath = asset.archive
      ? this.downloadPathFor(asset)
      : replacing
        ? `${finalPath}.new`
        : finalPath

    try {
      await mkdir(dirname(downloadPath), { recursive: true })
      await this.downloader.download({
        url: asset.url,
        destPath: downloadPath,
        signal: controller.signal,
        ...(asset.sha256 === undefined ? {} : { sha256: asset.sha256 }),
        ...(options.onProgress === undefined
          ? {}
          : {
              onProgress: (progress) =>
                options.onProgress?.(progress.receivedBytes, progress.totalBytes)
            })
      })

      if (downloadPath !== finalPath && !asset.archive) {
        await rename(downloadPath, finalPath)
      }
      if (asset.archive) {
        // 古い展開物に上書き展開すると、新しい版に無いファイルが混ざって残る。
        if (replacing && asset.entryPath) {
          await rm(join(this.modelsDir, topLevel(asset.entryPath)), { recursive: true, force: true })
        }
        await this.extract(downloadPath, asset.archive)
        // 展開後のアーカイブは容量を食うだけなので消す。
        await rm(downloadPath, { force: true })
      }
    } finally {
      this.running.delete(asset.id)
    }

    if (!(await this.exists(finalPath))) {
      throw new ModelStoreError({ code: 'modelExtractMissing', assetId: asset.id })
    }

    await this.recordInstalled(asset, finalPath)
    await this.discardPrevious(previous?.path, finalPath)
    return finalPath
  }

  private async isOutdated(asset: ManagedAsset, path: string): Promise<boolean> {
    if (asset.sha256 === undefined) return false
    const digest = await this.installedDigest(asset, path)
    return digest !== undefined && digest !== asset.sha256
  }

  private async recordInstalled(asset: ManagedAsset, path: string): Promise<void> {
    const managed = this.managedPath(path)
    const current = await statOf(path)
    if (asset.sha256 === undefined || managed === undefined || !current) return

    await this.manifest.set(asset.id, {
      path: managed,
      sha256: asset.sha256,
      size: current.size,
      mtimeMs: current.mtimeMs
    })
  }

  /** 保存名が変わった版に取り替えたとき、前の版のファイルを残さない（数 GB になりうる）。 */
  private async discardPrevious(previous: string | undefined, path: string): Promise<void> {
    const current = this.managedPath(path)
    if (previous === undefined || current === undefined) return
    if (topLevel(previous) === topLevel(current)) return
    await rm(join(this.modelsDir, topLevel(previous)), { recursive: true, force: true })
  }

  /**
   * macOS の tar は bz2 を、ditto は zip を直接扱えるため、展開ライブラリを
   * 持ち込まずに済む。
   *
   * zip に unzip ではなく ditto を使うのは、Apple 製の zip に入っている
   * __MACOSX（AppleDouble のリソースフォーク）を models ディレクトリに
   * 撒かないため。ditto は展開時にこれを本来の拡張属性へ戻して消す。
   * unzip だと remove() が消し切れないゴミが残る。
   */
  private async extract(
    archivePath: string,
    archive: NonNullable<ManagedAsset['archive']>
  ): Promise<void> {
    const [command, args] =
      archive === 'zip'
        ? (['/usr/bin/ditto', ['-x', '-k', archivePath, this.modelsDir]] as const)
        : (['/usr/bin/tar', ['-xjf', archivePath, '-C', this.modelsDir]] as const)

    try {
      await execFileAsync(command, [...args])
    } catch (error: unknown) {
      throw new ModelStoreError(
        { code: 'modelExtractFailed', detail: toMessage(error) },
        { cause: error }
      )
    }
  }
}

/** 展開先の最上位ディレクトリ名。'a/b/c.onnx' なら 'a'。 */
const topLevel = (entryPath: string): string => entryPath.split('/')[0] ?? entryPath

const statOf = async (path: string): Promise<{ size: number; mtimeMs: number } | undefined> => {
  try {
    const { size, mtimeMs } = await stat(path)
    return size > 0 ? { size, mtimeMs } : undefined
  } catch {
    return undefined
  }
}
