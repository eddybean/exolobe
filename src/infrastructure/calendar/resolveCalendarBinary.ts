import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 同梱した calendarevents の場所を解決する。置き方は micwatch と同じ
 * （scripts/build-calendarevents.sh が resources/bin へ生成し、配布版では Resources/bin に入る）。
 *
 * 見つからなければ undefined を返す。カレンダー連携が無効になるだけで、
 * 録音そのものは動く。
 */
export const resolveCalendarBinary = (params: {
  packaged: boolean
  resourcesPath: string
  cwd?: string
  exists?: (path: string) => boolean
}): string | undefined => {
  const exists = params.exists ?? existsSync
  const root = params.packaged ? params.resourcesPath : join(params.cwd ?? process.cwd(), 'resources')
  const path = join(root, 'bin', 'calendarevents')

  return exists(path) ? path : undefined
}
