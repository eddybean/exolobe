import { describe, expect, it } from 'vitest'
import { dependencyKey, isVersionOnlyChange } from '../../scripts/version-bump.mjs'

const packageJson = (version: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: 'exolobe', version, dependencies: { electron: '44.2.0' }, ...extra }, null, 2)

const lockfile = (version: string, electron = '44.2.0'): string =>
  JSON.stringify(
    {
      name: 'exolobe',
      version,
      lockfileVersion: 3,
      packages: {
        '': { name: 'exolobe', version, dependencies: { electron } },
        'node_modules/electron': { version: electron }
      }
    },
    null,
    2
  )

describe('isVersionOnlyChange', () => {
  it('package.json と package-lock.json の版だけが変わったなら true', () => {
    expect(
      isVersionOnlyChange([
        { path: 'package.json', before: packageJson('0.3.3'), after: packageJson('0.3.4') },
        { path: 'package-lock.json', before: lockfile('0.3.3'), after: lockfile('0.3.4') }
      ])
    ).toBe(true)
  })

  it('ほかのファイルも変わっていれば false', () => {
    expect(
      isVersionOnlyChange([
        { path: 'package.json', before: packageJson('0.3.3'), after: packageJson('0.3.4') },
        { path: 'src/main/index.ts', before: 'a', after: 'b' }
      ])
    ).toBe(false)
  })

  it('package.json の版以外（依存やスクリプト）も変わっていれば false', () => {
    expect(
      isVersionOnlyChange([
        {
          path: 'package.json',
          before: packageJson('0.3.3'),
          after: packageJson('0.3.4', { scripts: { test: 'vitest run' } })
        }
      ])
    ).toBe(false)
  })

  it('lockfile の依存が変わっていれば false', () => {
    expect(
      isVersionOnlyChange([
        { path: 'package-lock.json', before: lockfile('0.3.3'), after: lockfile('0.3.4', '44.3.0') }
      ])
    ).toBe(false)
  })

  // 読めない JSON は中身を比べられないので、確かめる側（CI を回す側）に倒す。
  it('JSON として読めなければ false', () => {
    expect(isVersionOnlyChange([{ path: 'package.json', before: packageJson('0.3.3'), after: '{' }])).toBe(false)
  })

  it('変更が無ければ false（判定する材料が無いので CI を回す）', () => {
    expect(isVersionOnlyChange([])).toBe(false)
  })
})

describe('dependencyKey', () => {
  it('版を上げても変わらない', () => {
    expect(dependencyKey(lockfile('0.3.4'))).toBe(dependencyKey(lockfile('0.3.3')))
  })

  it('依存が変われば変わる', () => {
    expect(dependencyKey(lockfile('0.3.3', '44.3.0'))).not.toBe(dependencyKey(lockfile('0.3.3')))
  })
})
