import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 同梱した applelm の場所を解決する（ADR-046）。
 *
 * micwatch と同じく scripts が resources/bin へ生成する成果物で、配布版では
 * electron-builder が Resources/bin へ入れる。開発時はリポジトリ直下の
 * resources/bin を見る（`npm run setup` か `npm run build:applelm` で作られる）。
 *
 * 見つからなければ undefined を返す。Apple Intelligence を選べなくなるだけで、
 * Gemma での要約は動く。
 */
export const resolveAppleLmBinary = (params: {
  packaged: boolean
  resourcesPath: string
  cwd?: string
  exists?: (path: string) => boolean
}): string | undefined => {
  const exists = params.exists ?? existsSync
  const root = params.packaged ? params.resourcesPath : join(params.cwd ?? process.cwd(), 'resources')
  const path = join(root, 'bin', 'applelm')

  return exists(path) ? path : undefined
}
