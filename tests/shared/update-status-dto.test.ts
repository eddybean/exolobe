import { describe, expect, it } from 'vitest'
import { toUpdateStatusDto } from '@shared/ipc'

describe('toUpdateStatusDto', () => {
  it('時刻は ISO 文字列にし、配布ページの URL は renderer に渡さない（開くのは main）', () => {
    // ユースケースの結果（UpdateStatus）は配布ページの URL も持っている。
    const status = {
      currentVersion: '0.2.2',
      checkedAt: new Date('2026-09-28T03:00:00Z'),
      available: {
        version: '0.3.0',
        pageUrl: 'https://github.com/eddybean/exolobe/releases/tag/v0.3.0',
        installSource: 'homebrew' as const
      }
    }
    const dto = toUpdateStatusDto(status)

    expect(dto).toEqual({
      currentVersion: '0.2.2',
      checkedAt: '2026-09-28T03:00:00.000Z',
      available: { version: '0.3.0', installSource: 'homebrew' }
    })
  })

  it('確かめていない・新しい版が無いときは null にする', () => {
    expect(toUpdateStatusDto({ currentVersion: '0.2.2', checkedAt: undefined, available: undefined })).toEqual({
      currentVersion: '0.2.2',
      checkedAt: null,
      available: null
    })
  })
})
