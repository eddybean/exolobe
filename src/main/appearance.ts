import { appearanceOf, type Appearance, type Settings } from '@domain/Settings'

/** Electron の nativeTheme のうち、ここで触る部分。テストで代役を渡せるようにする。 */
export interface ThemeSource {
  themeSource: Appearance
}

/**
 * 設定の明暗をアプリ全体に反映する。
 *
 * CSS だけで切り替えず nativeTheme を通すのは、renderer の prefers-color-scheme に加えて
 * ネイティブのダイアログやメニューも同じ明暗に揃うため。
 */
export const applyAppearance = (theme: ThemeSource, settings: Settings): void => {
  theme.themeSource = appearanceOf(settings)
}
