import { describe, expect, it } from 'vitest'
import { voiceprintSummary } from '@renderer/library/voiceprints'

describe('voiceprintSummary', () => {
  it('覚えた回数と最後に覚えた日を出す', () => {
    expect(
      voiceprintSummary({ name: '田中さん', samples: 3, updatedAt: '2026-09-10T09:00:00+09:00' })
    ).toBe('3 回の名付けで学習 ・ 9月10日')
  })

  it('1 回だけなら回数の表現を変える', () => {
    expect(
      voiceprintSummary({ name: '佐藤さん', samples: 1, updatedAt: '2026-09-12T09:00:00+09:00' })
    ).toBe('1 回の名付けで学習 ・ 9月12日')
  })

  it('去年以前なら年を添える', () => {
    expect(
      voiceprintSummary({ name: '鈴木さん', samples: 2, updatedAt: '2024-03-01T09:00:00+09:00' })
    ).toContain('2024年')
  })
})
