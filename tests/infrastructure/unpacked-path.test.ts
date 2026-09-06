import { describe, expect, it } from 'vitest'
import {
  resolveAudioTeeBinary,
  toUnpackedPath
} from '@infrastructure/audio/resolveAudioTeeBinary'

describe('toUnpackedPath', () => {
  it('asar 内のパスを unpacked 側へ読み替える', () => {
    expect(toUnpackedPath('/App.app/Contents/Resources/app.asar/node_modules/x/bin/y')).toBe(
      '/App.app/Contents/Resources/app.asar.unpacked/node_modules/x/bin/y'
    )
  })

  it('asar を含まないパスはそのまま返す', () => {
    expect(toUnpackedPath('/Users/me/project/node_modules/x/bin/y')).toBe(
      '/Users/me/project/node_modules/x/bin/y'
    )
  })

  it('すでに unpacked のパスを二重に書き換えない', () => {
    const path = '/App.app/Contents/Resources/app.asar.unpacked/node_modules/x/bin/y'
    expect(toUnpackedPath(path)).toBe(path)
  })
})

describe('resolveAudioTeeBinary', () => {
  const resourcesPath = '/App.app/Contents/Resources'
  const expected = `${resourcesPath}/app.asar.unpacked/node_modules/audiotee/bin/audiotee`

  it('パッケージ済みなら unpacked のバイナリを指す', () => {
    expect(
      resolveAudioTeeBinary({
        packaged: true,
        resourcesPath,
        exists: (path) => path === expected
      })
    ).toBe(expected)
  })

  it('開発時は undefined を返し、audiotee の既定解決に任せる', () => {
    expect(
      resolveAudioTeeBinary({ packaged: false, resourcesPath, exists: () => true })
    ).toBeUndefined()
  })

  it('パッケージ済みでもバイナリが無ければ undefined を返す', () => {
    expect(
      resolveAudioTeeBinary({ packaged: true, resourcesPath, exists: () => false })
    ).toBeUndefined()
  })
})
