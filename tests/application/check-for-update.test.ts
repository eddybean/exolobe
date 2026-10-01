import { describe, expect, it } from 'vitest'
import { CheckForUpdate } from '@application/usecases/CheckForUpdate'
import type { Settings } from '@domain/Settings'
import { defaultSettings } from '@domain/Settings'
import { FakeClock, FakeInstallSource, FakeReleaseFeed, FakeSettingsRepository, FakeUpdateCheckStore } from './fakes'

const DAY_MS = 86_400_000

/**
 * 新しい版の確認（ADR-044）。GitHub Releases を間隔ごとに 1 度だけ見て、今の版より新しければ
 * 入れ方つきで知らせる。見られないとき（リポジトリが非公開の間など）は「更新なし」として扱う。
 */
const build = (params: { settings?: Partial<Settings>; currentVersion?: string } = {}) => {
  const deps = {
    settings: new FakeSettingsRepository({
      ...defaultSettings('ja'),
      storageDir: '/storage',
      ...params.settings
    }),
    releases: new FakeReleaseFeed(),
    store: new FakeUpdateCheckStore(),
    installation: new FakeInstallSource(),
    clock: new FakeClock(new Date('2026-09-28T12:00:00+09:00')),
    currentVersion: params.currentVersion ?? '0.2.2'
  }
  return { ...deps, check: new CheckForUpdate(deps) }
}

const release = (version: string) => ({
  version,
  pageUrl: `https://github.com/eddybean/exolobe/releases/tag/v${version}`
})

describe('CheckForUpdate', () => {
  it('初めてなら Release を見て、新しい版を入れ方つきで知らせ、確認したことを覚える', async () => {
    const ctx = build()
    ctx.releases.result = { kind: 'found', release: release('0.3.0') }
    ctx.installation.source = 'homebrew'

    const status = await ctx.check.execute()

    expect(status.available).toEqual({ ...release('0.3.0'), installSource: 'homebrew' })
    expect(status.currentVersion).toBe('0.2.2')
    expect(status.checkedAt).toEqual(ctx.clock.now())
    expect(ctx.store.record).toEqual({ checkedAt: ctx.clock.now(), latest: release('0.3.0') })
  })

  it('間隔が過ぎるまでは問い合わせず、前回の結果で答える', async () => {
    const ctx = build()
    ctx.releases.result = { kind: 'found', release: release('0.3.0') }
    await ctx.check.execute()
    ctx.releases.result = { kind: 'found', release: release('0.4.0') }
    ctx.clock.advance(6 * DAY_MS)

    const status = await ctx.check.execute()

    expect(ctx.releases.calls).toBe(1)
    expect(status.available?.version).toBe('0.3.0')
  })

  it('間隔が過ぎたら問い合わせ直す', async () => {
    const ctx = build({ settings: { updateCheck: 'daily' } })
    await ctx.check.execute()
    ctx.releases.result = { kind: 'found', release: release('0.3.0') }
    ctx.clock.advance(DAY_MS)

    const status = await ctx.check.execute()

    expect(ctx.releases.calls).toBe(2)
    expect(status.available?.version).toBe('0.3.0')
  })

  it('覚えていた版が今の版以下なら知らせない（更新を入れた後）', async () => {
    const ctx = build({ currentVersion: '0.3.0' })
    ctx.store.record = { checkedAt: ctx.clock.now(), latest: release('0.3.0') }

    const status = await ctx.check.execute()

    expect(status.available).toBeUndefined()
    expect(ctx.releases.calls).toBe(0)
  })

  it('確認しない設定なら問い合わせず、覚えていた版も知らせない', async () => {
    const ctx = build({ settings: { updateCheck: 'never' } })
    ctx.store.record = { checkedAt: new Date('2026-01-01T00:00:00Z'), latest: release('0.3.0') }

    const status = await ctx.check.execute()

    expect(ctx.releases.calls).toBe(0)
    expect(status.available).toBeUndefined()
  })

  it('今すぐ確かめる操作なら、間隔内でも確認しない設定でも問い合わせる', async () => {
    const ctx = build({ settings: { updateCheck: 'never' } })
    ctx.store.record = { checkedAt: ctx.clock.now(), latest: undefined }
    ctx.releases.result = { kind: 'found', release: release('0.3.0') }

    const status = await ctx.check.execute({ force: true })

    expect(ctx.releases.calls).toBe(1)
    expect(status.available?.version).toBe('0.3.0')
  })

  it('Release が見られない（非公開・未公開）なら更新なしとして覚え、間隔まで問い合わせない', async () => {
    const ctx = build()
    ctx.store.record = { checkedAt: new Date('2026-01-01T00:00:00Z'), latest: release('0.3.0') }
    ctx.releases.result = { kind: 'none' }

    const status = await ctx.check.execute()
    await ctx.check.execute()

    expect(status.available).toBeUndefined()
    expect(ctx.store.record).toEqual({ checkedAt: ctx.clock.now(), latest: undefined })
    expect(ctx.releases.calls).toBe(1)
  })

  it('通信に失敗したら記録を変えず、前回の結果で答え、次の機会に問い合わせ直す', async () => {
    const ctx = build()
    const previous = { checkedAt: new Date('2026-01-01T00:00:00Z'), latest: release('0.3.0') }
    ctx.store.record = previous
    ctx.releases.result = { kind: 'unreachable' }

    const status = await ctx.check.execute()
    await ctx.check.execute()

    expect(status.available?.version).toBe('0.3.0')
    expect(status.checkedAt).toEqual(previous.checkedAt)
    expect(ctx.store.record).toBe(previous)
    expect(ctx.releases.calls).toBe(2)
  })
})
