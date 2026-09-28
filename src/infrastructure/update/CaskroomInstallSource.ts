import { access } from 'node:fs/promises'
import type { InstallSourcePort } from '@application/ports'
import type { InstallSource } from '@domain/AppUpdate'

/** Homebrew の cask が入る場所。Apple シリコンと Intel で prefix が違う。 */
export const CASKROOM_DIRS = ['/opt/homebrew/Caskroom/exolobe', '/usr/local/Caskroom/exolobe']

/**
 * Caskroom にこのアプリの記録があれば Homebrew で入れたとみなす。
 *
 * アプリ自身の置き場所では見分けられない（どちらも /Applications に置かれる）。
 */
export class CaskroomInstallSource implements InstallSourcePort {
  constructor(private readonly dirs: readonly string[] = CASKROOM_DIRS) {}

  async detect(): Promise<InstallSource> {
    for (const dir of this.dirs) {
      try {
        await access(dir)
        return 'homebrew'
      } catch {
        // 無ければ次の候補へ。
      }
    }
    return 'dmg'
  }
}
