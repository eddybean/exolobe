import { execFile } from 'node:child_process'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { ModelStorePort } from '@application/usecases/models'
import type { ManagedAsset, ManagedAssetId } from '@domain/ModelCatalog'
import { AppError, toMessage } from '@domain/errors'
import { AssetDownloader } from './AssetDownloader'

const execFileAsync = promisify(execFile)

export class ModelStoreError extends AppError {}

/**
 * モデルファイルをアプリの管理下に置く。
 *
 * 保存先はユーザーの録音保存先とは分ける。モデルは会議の成果物ではなく
 * 再取得できるキャッシュなので、録音のディレクトリを膨らませない。
 */
export class FileModelStore implements ModelStorePort {
  private readonly running = new Map<ManagedAssetId, AbortController>()

  constructor(
    private readonly modelsDir: string,
    private readonly downloader = new AssetDownloader()
  ) {}

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

    for (const target of targets) {
      await rm(target, { recursive: true, force: true })
    }
  }

  async fetch(
    asset: ManagedAsset,
    options: { onProgress?: (received: number, total: number | undefined) => void }
  ): Promise<string> {
    const finalPath = this.pathFor(asset)
    if (await this.exists(finalPath)) return finalPath

    const controller = new AbortController()
    this.running.set(asset.id, controller)

    // アーカイブは一度ダウンロードしてから展開する。
    const downloadPath = asset.archive ? this.downloadPathFor(asset) : finalPath

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

      if (asset.archive) {
        await this.extract(downloadPath)
        // 展開後のアーカイブは容量を食うだけなので消す。
        await rm(downloadPath, { force: true })
      }
    } finally {
      this.running.delete(asset.id)
    }

    if (!(await this.exists(finalPath))) {
      throw new ModelStoreError(
        `モデルの取得に失敗しました（${asset.label}）。展開後のファイルが見つかりません。`
      )
    }

    return finalPath
  }

  /** macOS の tar は bz2 を直接扱えるため、展開ライブラリを持ち込まずに済む。 */
  private async extract(archivePath: string): Promise<void> {
    try {
      await execFileAsync('/usr/bin/tar', ['-xjf', archivePath, '-C', this.modelsDir])
    } catch (error: unknown) {
      throw new ModelStoreError(`モデルの展開に失敗しました: ${toMessage(error)}`, {
        cause: error
      })
    }
  }
}

/** 展開先の最上位ディレクトリ名。'a/b/c.onnx' なら 'a'。 */
const topLevel = (entryPath: string): string => entryPath.split('/')[0] ?? entryPath
