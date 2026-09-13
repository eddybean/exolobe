import { stat } from 'node:fs/promises'
import type { FileInfoPort } from '@application/ports'

/**
 * 取り込み元ファイルの素性を読む。
 *
 * 読めなければ undefined を返す（NodeSystemResourceProbe.fileSize と同じ作法）。
 * 取り込みユースケースが「ファイルを読み取れません」と言い換えるので、ここでは
 * 例外の種類を伝えない。
 *
 * `electron` を import しない。将来ワーカーから使われても困らないようにするため。
 */
export class NodeFileInfoProbe implements FileInfoPort {
  async stat(path: string): Promise<{ sizeBytes: number; modifiedAt: Date } | undefined> {
    try {
      const stats = await stat(path)
      return { sizeBytes: stats.size, modifiedAt: stats.mtime }
    } catch {
      return undefined
    }
  }
}
