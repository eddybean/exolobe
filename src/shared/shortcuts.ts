import type { AppPlatform } from './platform'

export interface RecordingShortcut {
  /** Electron の globalShortcut に渡す形。 */
  readonly accelerator: string
  /** 画面に出す表記。 */
  readonly label: string
}

/**
 * どのアプリを見ていても録音を開始・停止するキー。登録（main）と表示（renderer）で
 * 食い違わないようここに一緒に置く。
 *
 * グローバルショートカットは他のアプリから同じキーを奪う。macOS では ⌘⇧R はブラウザの
 * 再読み込み、⌥⌘R は Safari の再読み込み、⌃⌘R は Xcode の実行に使われているため、
 * 修飾キーを 3 つ重ねて衝突しにくくする（⌃⌥⌘R）。Windows では Windows キーとの組み合わせを
 * OS が使うので、代わりに Shift を重ねる（ADR-048）。
 */
export const recordingShortcut = (platform: AppPlatform): RecordingShortcut =>
  platform === 'windows'
    ? { accelerator: 'Control+Alt+Shift+R', label: 'Ctrl+Alt+Shift+R' }
    : { accelerator: 'Control+Alt+Command+R', label: '⌃⌥⌘R' }
