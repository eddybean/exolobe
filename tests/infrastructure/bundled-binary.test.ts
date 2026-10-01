import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveBundledBinary } from '@infrastructure/system/resolveBundledBinary'

describe('resolveBundledBinary', () => {
  const exists = (): boolean => true

  it('配布版は Resources/bin の同梱物を使う', () => {
    expect(
      resolveBundledBinary('micwatch', { packaged: true, resourcesPath: '/App/Resources', platform: 'darwin', exists })
    ).toBe(join('/App/Resources', 'bin', 'micwatch'))
  })

  it('開発時はリポジトリの resources/bin を使う', () => {
    expect(
      resolveBundledBinary('micwatch', {
        packaged: false,
        resourcesPath: '/ignored',
        cwd: '/repo',
        platform: 'darwin',
        exists
      })
    ).toBe(join('/repo', 'resources', 'bin', 'micwatch'))
  })

  it('Windows では .exe を探す', () => {
    expect(
      resolveBundledBinary('micwatch', { packaged: true, resourcesPath: '/App/resources', platform: 'win32', exists })
    ).toBe(join('/App/resources', 'bin', 'micwatch.exe'))
  })

  it('無ければ undefined を返す（その機能だけが無効になる）', () => {
    expect(
      resolveBundledBinary('micwatch', {
        packaged: true,
        resourcesPath: '/App/Resources',
        platform: 'darwin',
        exists: () => false
      })
    ).toBeUndefined()
  })
})
