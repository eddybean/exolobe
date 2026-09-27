import {
  StorageError,
  isPlainObject,
  omitKeys,
  readStoredJson,
  replaceVersionedJson
} from '@infrastructure/persistence/jsonFile'

const SCHEMA_VERSION = 1

/** 手元のファイルが、どの配布物をどこへ置いたものか。 */
export interface InstalledRecord {
  /** models ディレクトリからの相対パス（実際に使うファイル）。 */
  readonly path: string
  /** 配布物の sha256。アーカイブならアーカイブのもの。 */
  readonly sha256: string
  /** 記録した時点のファイルの姿。変わっていれば記録を信じない。 */
  readonly size: number
  readonly mtimeMs: number
}

const isRecord = (value: unknown): value is InstalledRecord =>
  isPlainObject(value) &&
  typeof value.path === 'string' &&
  typeof value.sha256 === 'string' &&
  typeof value.size === 'number' &&
  typeof value.mtimeMs === 'number'

/**
 * 取得したモデルの記録（models/installed.json）。
 *
 * 数 GB のモデルを一覧を開くたびにハッシュし直さないためのキャッシュ。
 * ファイルから求め直せるので、書けなくても（新しい版が書いたなど）記録を
 * 諦めるだけで、取得や一覧の表示は止めない。
 */
export class ModelManifest {
  /** 一覧の表示では複数のモデルを並行に記録する。読んで書くあいだに割り込ませない。 */
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async get(id: string): Promise<InstalledRecord | undefined> {
    const stored = await this.read()
    if (stored.kind !== 'ok') return undefined
    const version = stored.value.schemaVersion
    // 知らない版の記録は意味が違うかもしれないので使わない。
    if (version !== undefined && version !== SCHEMA_VERSION) return undefined
    const assets = stored.value.assets
    const record = isPlainObject(assets) ? assets[id] : undefined
    return isRecord(record) ? record : undefined
  }

  /** undefined を渡すと記録を消す。 */
  set(id: string, record: InstalledRecord | undefined): Promise<void> {
    const next = this.writing.then(() => this.write(id, record))
    this.writing = next.catch(() => undefined)
    return next
  }

  private read() {
    return readStoredJson(this.path, isPlainObject)
  }

  private async write(id: string, record: InstalledRecord | undefined): Promise<void> {
    const previous = await this.read()
    const value = previous.kind === 'ok' ? previous.value : {}
    const assets = isPlainObject(value.assets) ? omitKeys(value.assets, [id]) : {}

    try {
      await replaceVersionedJson(this.path, previous, SCHEMA_VERSION, {
        // 新しい版が足したキーは残す（ADR-035）。
        ...omitKeys(value, ['assets']),
        assets: record === undefined ? assets : { ...assets, [id]: record }
      })
    } catch (error: unknown) {
      // 新しい版の記録は上書きしない。キャッシュなので次回また求め直せばよい。
      if (!(error instanceof StorageError)) throw error
    }
  }
}
