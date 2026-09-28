import { describe, expect, it } from 'vitest'
import { appleIntelligenceChoice } from '@renderer/summarizationModel'

describe('appleIntelligenceChoice', () => {
  it('使えるなら選べる', () => {
    expect(appleIntelligenceChoice('available')).toEqual({ selectable: true })
  })

  it('使えなければ選べず、理由を添える', () => {
    expect(appleIntelligenceChoice('apple-intelligence-not-enabled')).toEqual({
      selectable: false,
      reason: 'apple-intelligence-not-enabled'
    })
    expect(appleIntelligenceChoice('unsupported-os')).toEqual({
      selectable: false,
      reason: 'unsupported-os'
    })
  })

  it('問い合わせ中は選べないが、理由はまだ出さない', () => {
    // 開いた瞬間に「使えません」が点滅しないように。
    expect(appleIntelligenceChoice(undefined)).toEqual({ selectable: false })
  })
})
