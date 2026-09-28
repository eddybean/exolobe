import { describe, expect, it } from 'vitest'
import { isNewerVersion, isUpdateCheckDue, parseVersion } from '@domain/AppUpdate'

describe('parseVersion', () => {
  it('タグの v を外して数の組にする', () => {
    expect(parseVersion('v0.2.1')).toEqual([0, 2, 1])
    expect(parseVersion('1.10.0')).toEqual([1, 10, 0])
  })

  it('プレリリースや形の違うタグは版として扱わない', () => {
    expect(parseVersion('v0.3.0-beta.1')).toBeUndefined()
    expect(parseVersion('v1.2')).toBeUndefined()
    expect(parseVersion('nightly')).toBeUndefined()
  })
})

describe('isNewerVersion', () => {
  it('上の桁から数として比べる', () => {
    expect(isNewerVersion('v0.2.10', '0.2.9')).toBe(true)
    expect(isNewerVersion('v1.0.0', '0.9.9')).toBe(true)
    expect(isNewerVersion('v0.3.0', '0.2.9')).toBe(true)
  })

  it('同じ版や古い版は新しくない', () => {
    expect(isNewerVersion('v0.2.2', '0.2.2')).toBe(false)
    expect(isNewerVersion('v0.2.1', '0.2.2')).toBe(false)
  })

  it('どちらかが読めなければ知らせない', () => {
    expect(isNewerVersion('latest', '0.2.2')).toBe(false)
    expect(isNewerVersion('v0.3.0', 'dev')).toBe(false)
  })
})

describe('isUpdateCheckDue', () => {
  const now = new Date('2026-09-28T12:00:00+09:00')
  const daysAgo = (days: number): Date => new Date(now.getTime() - days * 86_400_000)

  it('一度も確かめていなければ確かめる', () => {
    expect(isUpdateCheckDue({ interval: 'weekly', lastCheckedAt: undefined, now })).toBe(true)
  })

  it('間隔が過ぎるまでは確かめない', () => {
    expect(isUpdateCheckDue({ interval: 'weekly', lastCheckedAt: daysAgo(6), now })).toBe(false)
    expect(isUpdateCheckDue({ interval: 'weekly', lastCheckedAt: daysAgo(7), now })).toBe(true)
    expect(isUpdateCheckDue({ interval: 'daily', lastCheckedAt: daysAgo(1), now })).toBe(true)
    expect(isUpdateCheckDue({ interval: 'monthly', lastCheckedAt: daysAgo(29), now })).toBe(false)
    expect(isUpdateCheckDue({ interval: 'monthly', lastCheckedAt: daysAgo(30), now })).toBe(true)
  })

  it('確認しない設定なら確かめない', () => {
    expect(isUpdateCheckDue({ interval: 'never', lastCheckedAt: undefined, now })).toBe(false)
  })

  it('時計が戻って前回が未来にあるなら確かめ直す', () => {
    expect(isUpdateCheckDue({ interval: 'weekly', lastCheckedAt: daysAgo(-3), now })).toBe(true)
  })
})
