import { describe, expect, it } from 'vitest'
import { toAppPlatform } from '@shared/platform'

describe('toAppPlatform', () => {
  it('win32 は windows', () => {
    expect(toAppPlatform('win32')).toBe('windows')
  })

  it('darwin は macos', () => {
    expect(toAppPlatform('darwin')).toBe('macos')
  })

  it('対応していない OS は macos として扱う（開発中に Linux で型検査やテストを回す程度の用途）', () => {
    expect(toAppPlatform('linux')).toBe('macos')
  })
})
