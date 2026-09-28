import { afterEach, describe, expect, it } from 'vitest'
import {
  MicDeviceMissingError,
  MicPermissionError,
  MicUnavailableError,
  describeMicFailure
} from '@renderer/audio/micErrors'
import { setLocale } from '@renderer/i18n/locale'

/** getUserMedia が投げる DOMException を name だけ再現する。 */
const domError = (name: string): Error => {
  const error = new Error(name)
  error.name = name
  return error
}

describe('describeMicFailure', () => {
  describe('マイクが接続されていないとき', () => {
    it('NotFoundError を「接続されていない」として扱う', () => {
      const result = describeMicFailure(domError('NotFoundError'))

      expect(result).toBeInstanceOf(MicDeviceMissingError)
      expect(result.message).toContain('マイクが見つかりません')
    })

    it('デバイスが無い機種があることを伝える', () => {
      // Mac mini や Mac Studio には内蔵マイクが無い。設定を探させないための案内。
      expect(describeMicFailure(domError('NotFoundError')).message).toContain('内蔵マイク')
    })

    it('権限の設定へ誘導しない', () => {
      // 存在しないデバイスの権限は設定画面に現れないため、案内すると探させてしまう
      expect(describeMicFailure(domError('NotFoundError')).message).not.toContain('プライバシー')
    })

    it('DevicesNotFoundError（旧称）も同じ扱いにする', () => {
      expect(describeMicFailure(domError('DevicesNotFoundError'))).toBeInstanceOf(
        MicDeviceMissingError
      )
    })
  })

  describe('権限が拒否されたとき', () => {
    it('NotAllowedError を権限エラーとして扱う', () => {
      const result = describeMicFailure(domError('NotAllowedError'))

      expect(result).toBeInstanceOf(MicPermissionError)
      expect(result.message).toContain('プライバシーとセキュリティ')
    })

    it('SecurityError と PermissionDeniedError も権限エラーにする', () => {
      expect(describeMicFailure(domError('SecurityError'))).toBeInstanceOf(MicPermissionError)
      expect(describeMicFailure(domError('PermissionDeniedError'))).toBeInstanceOf(
        MicPermissionError
      )
    })
  })

  describe('その他の失敗', () => {
    it('他のアプリが占有している場合を区別する', () => {
      const result = describeMicFailure(domError('NotReadableError'))

      expect(result).toBeInstanceOf(MicUnavailableError)
      expect(result.message).toContain('他のアプリ')
    })

    it('未知のエラーは原因を添えて返す', () => {
      const result = describeMicFailure(new Error('何かがおかしい'))

      expect(result).toBeInstanceOf(MicUnavailableError)
      expect(result.message).toContain('何かがおかしい')
    })

    it('Error でない値でも壊れない', () => {
      expect(() => describeMicFailure('文字列')).not.toThrow()
      expect(describeMicFailure(undefined).message.length).toBeGreaterThan(0)
    })
  })

  it('原因を cause として保持する', () => {
    const cause = domError('NotFoundError')
    expect(describeMicFailure(cause).cause).toBe(cause)
  })
})

describe('英語の UI', () => {
  afterEach(() => setLocale('ja'))

  it('デバイス不明・権限拒否・未知の失敗を英語で組み立てる', () => {
    setLocale('en')

    const missing = describeMicFailure(domError('NotFoundError'))
    expect(missing.message).toContain('No microphone was found')
    expect(missing.message).not.toContain('Privacy')

    const denied = describeMicFailure(domError('NotAllowedError'))
    expect(denied.message).toContain('Privacy & Security')

    const unknown = describeMicFailure(new Error('something is wrong'))
    expect(unknown.message).toContain('something is wrong')
  })
})
