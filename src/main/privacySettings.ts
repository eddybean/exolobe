/**
 * 「システム設定を開く」で開く、プライバシーとセキュリティの画面。
 *
 * renderer から来た値で URL を組み立てると任意の URL を開けてしまうので、
 * 決まった種類だけを決まった URL に対応させ、それ以外は開かない。
 */
const MAC_PRIVACY_SETTINGS_URLS = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  // システム音声だけの許可（Core Audio Tap、ADR-001）は「画面収録とシステムオーディオ録音」の
  // 画面の中の「システムオーディオ録音のみ」にある。専用の画面を直接開く URL は
  // macOS の版ごとの動作を確かめられなかったので、確実に開けるこの画面へ案内する。
  'system-audio': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  calendars: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'
} as const

export type PrivacyPane = keyof typeof MAC_PRIVACY_SETTINGS_URLS

// Windows はシステム音声の取り込み（WASAPI loopback）に許可を求めず、カレンダー連携も持たない
// （ADR-048）ので、開く画面があるのはマイクだけ。
const WINDOWS_PRIVACY_SETTINGS_URLS: Partial<Record<PrivacyPane, string>> = {
  microphone: 'ms-settings:privacy-microphone'
}

const isPrivacyPane = (value: unknown): value is PrivacyPane =>
  typeof value === 'string' && Object.hasOwn(MAC_PRIVACY_SETTINGS_URLS, value)

export const privacySettingsUrl = (pane: unknown, platform: NodeJS.Platform = process.platform): string | undefined => {
  if (!isPrivacyPane(pane)) return undefined
  return platform === 'win32' ? WINDOWS_PRIVACY_SETTINGS_URLS[pane] : MAC_PRIVACY_SETTINGS_URLS[pane]
}
