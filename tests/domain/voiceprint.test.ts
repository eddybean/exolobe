import { describe, expect, it } from 'vitest'
import {
  VOICEPRINT_MATCH_MARGIN,
  forgetSource,
  matchVoiceprints,
  registerVoice,
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
  sources: [{ key: `src:${name}`, vector: voice(degrees) }],
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
    const matched = matchVoiceprints([speaker('remote:spk0', 5)], [print('田中さん', 0), print('佐藤さん', 10)], {
      threshold: 0.6,
      modelKey: MODEL
    })

    expect(matched.size).toBe(0)
  })

  it('別のモデルで作られた声紋は比較しない', () => {
    const matched = matchVoiceprints([speaker('remote:spk0', 0)], [print('田中さん', 0, { modelKey: 'other:256' })], {
      threshold: 0.6,
      modelKey: MODEL
    })

    expect(matched.size).toBe(0)
  })

  it('同じ名前を 2 人が取り合ったら、似ている方だけに付ける', () => {
    const matched = matchVoiceprints([speaker('remote:spk0', 20), speaker('remote:spk1', 2)], [print('田中さん', 0)], {
      threshold: 0.6,
      modelKey: MODEL
    })

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
    expect(matchVoiceprints([speaker('remote:spk0', 0)], [], { threshold: 0.6, modelKey: MODEL })).toEqual(new Map())
  })

  it('既定の余白は誤適用を避けられる程度に取ってある', () => {
    expect(VOICEPRINT_MATCH_MARGIN).toBeGreaterThan(0)
  })
})

describe('registerVoice', () => {
  const now = new Date('2026-09-13T12:00:00.000Z')
  const at = (iso: string): Date => new Date(iso)

  it('未登録なら 1 件目として作る', () => {
    const registered = registerVoice(undefined, {
      name: '田中さん',
      source: 'rec-1:remote:spk0',
      vector: voice(0),
      modelKey: MODEL,
      now
    })

    expect(registered.name).toBe('田中さん')
    expect(registered.sources.map((s) => s.key)).toEqual(['rec-1:remote:spk0'])
    expect(registered.modelKey).toBe(MODEL)
    expect(registered.updatedAt).toBe('2026-09-13T12:00:00.000Z')
  })

  it('別の録音で同じ名前を付けると、平均を取って出所が増える', () => {
    const first = registerVoice(undefined, {
      name: '田中さん',
      source: 'rec-1:remote:spk0',
      vector: voice(0),
      modelKey: MODEL,
      now: at('2026-09-01T00:00:00.000Z')
    })

    const second = registerVoice(first, {
      name: '田中さん',
      source: 'rec-2:remote:spk1',
      vector: voice(90),
      modelKey: MODEL,
      now
    })

    expect(second.sources).toHaveLength(2)
    // 0 度と 90 度の平均は 45 度。
    expect(second.vector[0]).toBeCloseTo(Math.SQRT1_2, 5)
    expect(second.vector[1]).toBeCloseTo(Math.SQRT1_2, 5)
  })

  it('同じ出所を付け直しても数は増えず、声紋が差し替わる', () => {
    const first = registerVoice(undefined, {
      name: '田中さん',
      source: 'rec-1:remote:spk0',
      vector: voice(0),
      modelKey: MODEL,
      now: at('2026-09-01T00:00:00.000Z')
    })

    const again = registerVoice(first, {
      name: '田中さん',
      source: 'rec-1:remote:spk0',
      vector: voice(90),
      modelKey: MODEL,
      now
    })

    expect(again.sources).toHaveLength(1)
    expect(again.vector[1]).toBeCloseTo(1, 5)
  })

  it('出所が増えるほど 1 件ぶんの影響は小さい', () => {
    let entry = registerVoice(undefined, {
      name: '田中さん',
      source: 'rec-0:remote:spk0',
      vector: voice(0),
      modelKey: MODEL,
      now
    })
    for (let index = 1; index < 9; index += 1) {
      entry = registerVoice(entry, {
        name: '田中さん',
        source: `rec-${index}:remote:spk0`,
        vector: voice(0),
        modelKey: MODEL,
        now
      })
    }

    const shifted = registerVoice(entry, {
      name: '田中さん',
      source: 'rec-9:remote:spk0',
      vector: voice(90),
      modelKey: MODEL,
      now
    })

    expect(shifted.vector[1]).toBeLessThan(0.2)
  })

  it('モデルが変わっていたら過去の出所を捨てて作り直す', () => {
    const old = registerVoice(undefined, {
      name: '田中さん',
      source: 'rec-1:remote:spk0',
      vector: voice(0),
      modelKey: 'other:256',
      now
    })

    const fresh = registerVoice(old, {
      name: '田中さん',
      source: 'rec-2:remote:spk0',
      vector: voice(90),
      modelKey: MODEL,
      now
    })

    expect(fresh.sources.map((s) => s.key)).toEqual(['rec-2:remote:spk0'])
    expect(fresh.modelKey).toBe(MODEL)
    expect(fresh.vector[1]).toBeCloseTo(1, 5)
  })
})

describe('forgetSource', () => {
  const now = new Date('2026-09-13T12:00:00.000Z')

  const withSources = (name: string, entries: [string, number][]): Voiceprint =>
    entries.reduce<Voiceprint | undefined>(
      (entry, [source, degrees]) =>
        registerVoice(entry, { name, source, vector: voice(degrees), modelKey: MODEL, now }),
      undefined
    ) as Voiceprint

  it('唯一の出所を取り消すと声紋ごと消える', () => {
    const entry = withSources('田中さん', [['rec-1:remote:spk0', 0]])

    expect(forgetSource(entry, 'rec-1:remote:spk0', now)).toBeUndefined()
  })

  it('残る出所があれば、それだけで平均を取り直す', () => {
    const entry = withSources('田中さん', [
      ['rec-1:remote:spk0', 0],
      ['rec-2:remote:spk0', 90]
    ])

    const remaining = forgetSource(entry, 'rec-1:remote:spk0', now)

    expect(remaining?.sources.map((s) => s.key)).toEqual(['rec-2:remote:spk0'])
    expect(remaining?.vector[1]).toBeCloseTo(1, 5)
  })

  it('持っていない出所を取り消しても何も変えない', () => {
    const entry = withSources('田中さん', [['rec-1:remote:spk0', 0]])

    expect(forgetSource(entry, 'rec-9:remote:spk0', now)).toBe(entry)
  })
})
