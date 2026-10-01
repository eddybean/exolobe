import { describe, expect, it } from 'vitest'
import { platformFeatures } from '@shared/platform'

describe('platformFeatures', () => {
  it('macOS ではすべて使える', () => {
    expect(platformFeatures('macos')).toEqual({ appleIntelligence: true, heAac: true, calendar: true })
  })

  it('Windows では Apple Intelligence・HE-AAC・カレンダー連携を使わない（ADR-048）', () => {
    expect(platformFeatures('windows')).toEqual({ appleIntelligence: false, heAac: false, calendar: false })
  })
})
