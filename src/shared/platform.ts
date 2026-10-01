/**
 * アプリが動いている OS（ADR-048）。renderer は Node の型を知らないので、process.platform を
 * そのまま渡さずこの 2 つに読み替える。ショートカットの表記・文言・選べる設定の出し分けに使う。
 */
export type AppPlatform = 'macos' | 'windows'

export const toAppPlatform = (platform: string): AppPlatform => (platform === 'win32' ? 'windows' : 'macos')
