import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@domain/Settings'
import { applyAppearance, type ThemeSource } from '../../src/main/appearance'

/**
 * nativeTheme.themeSource に渡すと、renderer の prefers-color-scheme もネイティブの
 * ダイアログ・メニューも同じ明暗に揃う。CSS 側で切り替えるとダイアログだけ OS に従って食い違う。
 */
describe('applyAppearance', () => {
  it('設定の明暗をそのまま themeSource に渡す', () => {
    const theme: ThemeSource = { themeSource: 'system' }

    applyAppearance(theme, { ...defaultSettings('ja'), appearance: 'dark' })

    expect(theme.themeSource).toBe('dark')
  })

  it('知らない値なら OS に従う', () => {
    const theme: ThemeSource = { themeSource: 'dark' }

    applyAppearance(theme, { ...defaultSettings('ja'), appearance: 'sepia' } as never)

    expect(theme.themeSource).toBe('system')
  })
})
