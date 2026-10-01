import { afterEach, describe, expect, it } from 'vitest'
import { platform, setPlatform } from '@renderer/platform'

describe('platform', () => {
  afterEach(() => setPlatform('macos'))

  it('受け取るまでは macOS として扱う（テストの既定）', () => {
    expect(platform()).toBe('macos')
  })

  it('main から受け取った OS を返す', () => {
    setPlatform('windows')

    expect(platform()).toBe('windows')
  })
})
