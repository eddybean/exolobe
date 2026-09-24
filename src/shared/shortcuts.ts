/**
 * どのアプリを見ていても録音を開始・停止するキー（⌃⌥⌘R）。
 *
 * グローバルショートカットは他のアプリから同じキーを奪う。⌘⇧R はブラウザの
 * 再読み込み、⌥⌘R は Safari の再読み込み、⌃⌘R は Xcode の実行に使われているため、
 * 修飾キーを 3 つ重ねて衝突しにくくする。登録（main）と表示（renderer）で食い違わないよう
 * ここに一緒に置く。
 */
export const RECORDING_SHORTCUT = {
  accelerator: 'Control+Alt+Command+R',
  label: '⌃⌥⌘R'
} as const
