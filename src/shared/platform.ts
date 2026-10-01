/**
 * アプリが動いている OS（ADR-048）。renderer は Node の型を知らないので、process.platform を
 * そのまま渡さずこの 2 つに読み替える。ショートカットの表記・文言・選べる設定の出し分けに使う。
 */
export type AppPlatform = 'macos' | 'windows'

export const toAppPlatform = (platform: string): AppPlatform => (platform === 'win32' ? 'windows' : 'macos')

/** OS によって有無が変わる機能。設定画面の選択肢の出し分けに使う。 */
export interface PlatformFeatures {
  /** 要約のモデルに Apple Intelligence を選べるか（ADR-046）。 */
  readonly appleIntelligence: boolean
  /** 音声を HE-AAC で保存できるか。Windows の標準のエンコーダは AAC-LC だけを扱う見込み。 */
  readonly heAac: boolean
  /** カレンダー連携（ADR-040）。Windows にはローカルで完結する予定の取得手段が無い。 */
  readonly calendar: boolean
}

export const platformFeatures = (platform: AppPlatform): PlatformFeatures => {
  const mac = platform === 'macos'
  return { appleIntelligence: mac, heAac: mac, calendar: mac }
}
