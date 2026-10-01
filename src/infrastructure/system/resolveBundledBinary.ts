import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface BundledBinaryParams {
  packaged: boolean
  resourcesPath: string
  cwd?: string
  /** 既定は実行中の OS。Windows の exe は拡張子まで書かないと existsSync で見つからない。 */
  platform?: NodeJS.Platform
  exists?: (path: string) => boolean
}

/**
 * 同梱した補助プログラム（micwatch など）の場所を解決する。
 *
 * scripts が resources/bin へ生成する成果物で、配布版では electron-builder が Resources/bin へ入れる。
 * 開発時はリポジトリ直下の resources/bin を見る。
 *
 * 見つからなければ undefined を返す。その機能が無効になるだけで、録音そのものは動く。
 * ここで例外にすると、まだ作っていない開発環境や、その OS 向けの補助プログラムが無い配布版で
 * アプリが起動しなくなる（ADR-048）。
 */
export const resolveBundledBinary = (name: string, params: BundledBinaryParams): string | undefined => {
  const exists = params.exists ?? existsSync
  const platform = params.platform ?? process.platform
  const root = params.packaged ? params.resourcesPath : join(params.cwd ?? process.cwd(), 'resources')
  const path = join(root, 'bin', platform === 'win32' ? `${name}.exe` : name)

  return exists(path) ? path : undefined
}
