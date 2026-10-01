import { describe, expect, it } from 'vitest'
import { privacySettingsUrl } from '../../src/main/privacySettings'

/**
 * 「システム設定を開く」で開く画面。renderer から来た値でそのまま URL を組み立てると
 * 任意の URL を開けてしまうので、決まった種類だけを決まった URL に対応させる。
 */
describe('privacySettingsUrl', () => {
  it('マイクはプライバシーとセキュリティのマイクの画面', () => {
    expect(privacySettingsUrl('microphone', 'darwin')).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    )
  })

  it('システム音声は「画面収録とシステムオーディオ録音」の画面', () => {
    expect(privacySettingsUrl('system-audio', 'darwin')).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  })

  it('カレンダーはプライバシーとセキュリティのカレンダーの画面', () => {
    expect(privacySettingsUrl('calendars', 'darwin')).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'
    )
  })

  it('知らない種類には URL を返さない', () => {
    expect(privacySettingsUrl('https://example.com', 'darwin')).toBeUndefined()
  })
})

describe('privacySettingsUrl（Windows）', () => {
  it('マイクは設定アプリのプライバシーのマイクの画面', () => {
    expect(privacySettingsUrl('microphone', 'win32')).toBe('ms-settings:privacy-microphone')
  })

  it('システム音声とカレンダーは開く画面が無い（Windows はシステム音声の取り込みに許可を求めず、カレンダー連携も持たない）', () => {
    expect(privacySettingsUrl('system-audio', 'win32')).toBeUndefined()
    expect(privacySettingsUrl('calendars', 'win32')).toBeUndefined()
  })
})
