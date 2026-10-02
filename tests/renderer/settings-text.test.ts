import { describe, expect, it } from 'vitest'
import { setLocale } from '@renderer/i18n/locale'
import { settingsText } from '@renderer/i18n/settings'

describe('whisper-cli のパスの説明', () => {
  it('macOS は Homebrew で入れた場合の案内のまま', () => {
    expect(settingsText().transcription.binaryPathHint('macos')).toContain('Homebrew')
  })

  it('Windows には Homebrew が無いので、同梱版を使うことを案内する', () => {
    const hint = settingsText().transcription.binaryPathHint('windows')

    expect(hint).not.toContain('Homebrew')
    expect(hint).toContain('同梱')
  })

  it('英語でも OS ごとに分ける', () => {
    setLocale('en')
    try {
      expect(settingsText().transcription.binaryPathHint('windows')).not.toContain('Homebrew')
      expect(settingsText().transcription.binaryPathHint('macos')).toContain('Homebrew')
    } finally {
      setLocale('ja')
    }
  })
})
