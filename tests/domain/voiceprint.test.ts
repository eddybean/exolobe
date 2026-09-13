import { describe, expect, it } from 'vitest'
import {
  VOICEPRINT_MATCH_MARGIN,
  matchVoiceprints,
  mergeVoiceprint,
  type SpeakerVector,
  type Voiceprint
} from '@domain/Voiceprint'
import { normalize } from '@domain/vector'

const MODEL = 'campplus:192'

/** 2 次元で「声」を作る。角度が近いほど似た声。 */
const voice = (degrees: number): Float32Array => {
  const radians = (degrees * Math.PI) / 180
  return normalize([Math.cos(radians), Math.sin(radians)])
}

const speaker = (speakerId: string, degrees: number): SpeakerVector => ({
  speakerId,
  vector: voice(degrees)
})

const print = (name: string, degrees: number, overrides: Partial<Voiceprint> = {}): Voiceprint => ({
  name,
  vector: voice(degrees),
  samples: 1,
  modelKey: MODEL,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
})

describe('matchVoiceprints', () => {
  it('閾値を超えた話者に登録済みの名前を割り当てる', () => {
    const matched = matchVoiceprints([speaker('remote:spk0', 2)], [print('田中さん', 0)], {
      threshold: 0.6,
      modelKey: MODEL
    })

    expect(matched.get('remote:spk0')).toBe('田中さん')
  })

  it('閾値に届かなければ割り当てない', () => {
    const matched = matchVoiceprints([speaker('remote:spk0', 80)], [print('田中さん', 0)], {
      threshold: 0.6,
      modelKey: MODEL
    })

    expect(matched.size).toBe(0)
  })

  it('2 位との差が僅かなら、当てにいかず未割り当てにする', () => {
    // どちらとも 0.99 以上で並ぶ位置に置く。
    const matched = matchVoiceprints(
      [speaker('remote:spk0', 5)],
      [print('田中さん', 0), print('佐藤さん', 10)],
      { threshold: 0.6, modelKey: MODEL }
    )

    expect(matched.size).toBe(0)
  })

  it('別のモデルで作られた声紋は比較しない', () => {
    const matched = matchVoiceprints(
      [speaker('remote:spk0', 0)],
      [print('田中さん', 0, { modelKey: 'other:256' })],
      { threshold: 0.6, modelKey: MODEL }
    )

    expect(matched.size).toBe(0)
  })

  it('同じ名前を 2 人が取り合ったら、似ている方だけに付ける', () => {
    const matched = matchVoiceprints(
      [speaker('remote:spk0', 20), speaker('remote:spk1', 2)],
      [print('田中さん', 0)],
      { threshold: 0.6, modelKey: MODEL }
    )

    expect([...matched]).toEqual([['remote:spk1', '田中さん']])
  })

  it('複数の話者にそれぞれの名前を割り当てる', () => {
    const matched = matchVoiceprints(
      [speaker('remote:spk0', 1), speaker('remote:spk1', 89)],
      [print('田中さん', 0), print('佐藤さん', 90)],
      { threshold: 0.6, modelKey: MODEL }
    )

    expect(matched.get('remote:spk0')).toBe('田中さん')
    expect(matched.get('remote:spk1')).toBe('佐藤さん')
  })

  it('声紋帳が空なら何も返さない', () => {
    expect(matchVoiceprints([speaker('remote:spk0', 0)], [], { threshold: 0.6, modelKey: MODEL }))
      .toEqual(new Map())
  })

  it('既定の余白は誤適用を避けられる程度に取ってある', () => {
    expect(VOICEPRINT_MATCH_MARGIN).toBeGreaterThan(0)
  })
})

describe('mergeVoiceprint', () => {
  const now = new Date('2026-09-13T12:00:00.000Z')

  it('未登録なら 1 件目として作る', () => {
    const merged = mergeVoiceprint(undefined, {
      name: '田中さん',
      vector: voice(0),
      modelKey: MODEL,
      now
    })

    expect(merged.name).toBe('田中さん')
    expect(merged.samples).toBe(1)
    expect(merged.modelKey).toBe(MODEL)
    expect(merged.updatedAt).toBe('2026-09-13T12:00:00.000Z')
  })

  it('登録済みなら平均を取り、回数を増やす', () => {
    const existing = print('田中さん', 0, { samples: 1 })
    const merged = mergeVoiceprint(existing, {
      name: '田中さん',
      vector: voice(90),
      modelKey: MODEL,
      now
    })

    expect(merged.samples).toBe(2)
    // 0 度と 90 度の平均は 45 度。
    expect(merged.vector[0]).toBeCloseTo(Math.SQRT1_2, 5)
    expect(merged.vector[1]).toBeCloseTo(Math.SQRT1_2, 5)
  })

  it('回数を重ねた声紋ほど 1 回ぶんの影響は小さい', () => {
    const existing = print('田中さん', 0, { samples: 9 })
    const merged = mergeVoiceprint(existing, {
      name: '田中さん',
      vector: voice(90),
      modelKey: MODEL,
      now
    })

    // 9:1 の重みなので、90 度側へはわずかしか動かない。
    expect(merged.vector[1]).toBeLessThan(0.2)
  })

  it('モデルが変わっていたら平均せず、新しい声紋で置き換える', () => {
    const existing = print('田中さん', 0, { samples: 5, modelKey: 'other:256' })
    const merged = mergeVoiceprint(existing, {
      name: '田中さん',
      vector: voice(90),
      modelKey: MODEL,
      now
    })

    expect(merged.samples).toBe(1)
    expect(merged.modelKey).toBe(MODEL)
    expect(merged.vector[1]).toBeCloseTo(1, 5)
  })
})
