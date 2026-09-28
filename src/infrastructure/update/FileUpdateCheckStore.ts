import type { PublishedRelease, UpdateCheckRecord, UpdateCheckStorePort } from '@application/ports'
import { isPlainObject, readJson, writeJsonAtomic } from '@infrastructure/persistence/jsonFile'

/**
 * 前回の更新の確認（`userData/update-check.json`）。
 *
 * 失っても次に確かめ直すだけのキャッシュなので、読めない中身は無いものとして上書きする
 * （ADR-035 の退避は、再生成できないファイルのためのもの）。
 */
export class FileUpdateCheckStore implements UpdateCheckStorePort {
  constructor(private readonly path: string) {}

  async load(): Promise<UpdateCheckRecord | undefined> {
    const value = await readJson(this.path)
    if (!isPlainObject(value) || typeof value['checkedAt'] !== 'string') return undefined

    const checkedAt = new Date(value['checkedAt'])
    if (Number.isNaN(checkedAt.getTime())) return undefined

    const latest = value['latest']
    if (latest === undefined) return { checkedAt, latest: undefined }
    return isRelease(latest) ? { checkedAt, latest } : undefined
  }

  async save(record: UpdateCheckRecord): Promise<void> {
    await writeJsonAtomic(this.path, {
      checkedAt: record.checkedAt.toISOString(),
      latest: record.latest
    })
  }
}

/** 配布ページは main が既定のブラウザで開くので、GitHub のものに限る。 */
const isRelease = (value: unknown): value is PublishedRelease =>
  isPlainObject(value) &&
  typeof value['version'] === 'string' &&
  typeof value['pageUrl'] === 'string' &&
  value['pageUrl'].startsWith('https://github.com/')
