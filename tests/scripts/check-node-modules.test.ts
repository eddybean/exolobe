import { describe, expect, it } from 'vitest'
import { describeStaleness, findStaleDependencies } from '../../scripts/check-node-modules.mjs'

const lock = {
  packages: {
    '': { name: 'exolobe', version: '0.1.1' },
    'node_modules/electron': { version: '44.2.0' },
    'node_modules/@electron/get/node_modules/semver': { version: '7.7.2' },
    // 別 OS 向けのネイティブなど。この Mac では入らないのが正しい。
    'node_modules/@esbuild/linux-x64': { version: '0.25.0', optional: true },
    'node_modules/dmg-license': { version: '1.0.11', devOptional: true }
  }
}

describe('findStaleDependencies', () => {
  it('lockfile どおりに入っていれば何も返さない', () => {
    const installed = {
      packages: {
        'node_modules/electron': { version: '44.2.0' },
        'node_modules/@electron/get/node_modules/semver': { version: '7.7.2' }
      }
    }

    expect(findStaleDependencies(lock, installed)).toEqual([])
  })

  it('版が違うものを返す', () => {
    const installed = {
      packages: {
        'node_modules/electron': { version: '33.4.11' },
        'node_modules/@electron/get/node_modules/semver': { version: '7.7.2' }
      }
    }

    expect(findStaleDependencies(lock, installed)).toEqual([
      { name: 'electron', expected: '44.2.0', actual: '33.4.11' }
    ])
  })

  it('入っていないものを返す（入れ子の依存も名前を読める形にする）', () => {
    const installed = { packages: { 'node_modules/electron': { version: '44.2.0' } } }

    expect(findStaleDependencies(lock, installed)).toEqual([
      { name: '@electron/get/node_modules/semver', expected: '7.7.2', actual: undefined }
    ])
  })

  it('optional の依存が入っていないのは正常として扱う', () => {
    const installed = {
      packages: {
        'node_modules/electron': { version: '44.2.0' },
        'node_modules/@electron/get/node_modules/semver': { version: '7.7.2' }
      }
    }

    expect(findStaleDependencies(lock, installed)).toEqual([])
  })

  it('optional の依存でも、入っていて版が違えば返す', () => {
    const installed = {
      packages: {
        'node_modules/electron': { version: '44.2.0' },
        'node_modules/@electron/get/node_modules/semver': { version: '7.7.2' },
        'node_modules/dmg-license': { version: '1.0.9' }
      }
    }

    expect(findStaleDependencies(lock, installed)).toEqual([
      { name: 'dmg-license', expected: '1.0.11', actual: '1.0.9' }
    ])
  })
})

describe('describeStaleness', () => {
  it('件数と例を挙げて npm ci を促す', () => {
    const message = describeStaleness([
      { name: 'electron', expected: '44.2.0', actual: '33.4.11' },
      { name: '@electron/fuses', expected: '2.0.0', actual: undefined },
      { name: 'vite', expected: '7.1.0', actual: '6.0.0' },
      { name: 'vitest', expected: '4.0.0', actual: '3.0.0' }
    ])

    expect(message).toBe(
      [
        'node_modules が package-lock.json と食い違っています（4 件）。',
        '  electron: 44.2.0 が必要ですが 33.4.11 が入っています',
        '  vite: 7.1.0 が必要ですが 6.0.0 が入っています',
        '  vitest: 4.0.0 が必要ですが 3.0.0 が入っています',
        '  ほか 1 件',
        'npm ci を実行してください。'
      ].join('\n')
    )
  })

  it('例には版が違うものを先に挙げる（入っていないものより原因を示しやすい）', () => {
    const message = describeStaleness([
      { name: '@electron/fuses', expected: '1.8.0', actual: undefined },
      { name: 'electron', expected: '44.2.0', actual: '33.4.11' }
    ])

    expect(message.split('\n').slice(1, 3)).toEqual([
      '  electron: 44.2.0 が必要ですが 33.4.11 が入っています',
      '  @electron/fuses: 1.8.0 が必要ですが入っていません'
    ])
  })

  it('node_modules がまだ無いときは install を促す', () => {
    expect(describeStaleness(undefined)).toBe(
      'node_modules がまだありません。npm ci を実行してください。'
    )
  })
})
