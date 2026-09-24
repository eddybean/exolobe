import { describe, expect, it } from 'vitest'
import { privacySettingsUrl } from '../../src/main/privacySettings'

/**
 * 「システム設定を開く」で開く画面。renderer から来た値でそのまま URL を組み立てると
 * 任意の URL を開けてしまうので、決まった種類だけを決まった URL に対応させる。
 */
describe('privacySettingsUrl', () => {
  it('マイクはプライバシーとセキュリティのマイクの画面', () => {
    expect(privacySettingsUrl('microphone')).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    )
  })

  it('システム音声は「画面収録とシステムオーディオ録音」の画面', () => {
    expect(privacySettingsUrl('system-audio')).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  })

  it('知らない種類には URL を返さない', () => {
    expect(privacySettingsUrl('https://example.com')).toBeUndefined()
  })
})
