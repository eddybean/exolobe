import { afterEach, describe, expect, it } from 'vitest'
import { detailText } from '@renderer/i18n/detail'
import { setLocale } from '@renderer/i18n/locale'
import { updateText } from '@renderer/i18n/update'

describe('OS で変わる文言', () => {
  afterEach(() => setLocale('ja'))

  it('音声ファイルを見せる先は、macOS は Finder、Windows はエクスプローラー', () => {
    expect(detailText().header.revealInFileManager('macos')).toBe('Finder で表示')
    expect(detailText().header.revealInFileManager('windows')).toBe('エクスプローラーで表示')

    setLocale('en')
    expect(detailText().header.revealInFileManager('macos')).toBe('Show in Finder')
    expect(detailText().header.revealInFileManager('windows')).toBe('Show in File Explorer')
  })

  it('新しい版の入れ方は、macOS は DMG、Windows はインストーラ', () => {
    expect(updateText().downloadHint('macos')).toContain('DMG')
    expect(updateText().downloadHint('windows')).toContain('インストーラ')
    expect(updateText().downloadHint('windows')).not.toContain('DMG')
  })
})
