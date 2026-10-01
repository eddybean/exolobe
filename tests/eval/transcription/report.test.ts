import { describe, expect, it } from 'vitest'
import { environmentDifferences, formatComparison, type CaseResult, type EvalEnvironment } from './report'

const result = (overrides: Partial<CaseResult> = {}): CaseResult => ({
  scenario: 'meeting',
  config: 'vad',
  cer: 0.2,
  hallucinatedChars: 0,
  missedUtterances: 1,
  utterances: 10,
  longestRepeatRun: 1,
  dropped: { 'non-speech': 0, boilerplate: 2, 'low-confidence': 0, repetition: 0 },
  ...overrides
})

const environment: EvalEnvironment = {
  macos: '26.0',
  whisper: '1.9.4-dev',
  model: 'ggml-large-v3-turbo-q5_0.bin',
  voices: ['Kyoko']
}

describe('formatComparison', () => {
  it('基準との差を符号つきで並べる', () => {
    const table = formatComparison(
      [result({ cer: 0.15, hallucinatedChars: 3 })],
      [result({ cer: 0.2, hallucinatedChars: 0 })]
    )

    expect(table).toContain('| meeting | vad | 0.150 (-0.050) | 3 (+3) | 1/10 | 1 | boilerplate 2 |')
  })

  it('基準に無い組み合わせは差を出さない', () => {
    const table = formatComparison([result({ scenario: 'music' })], [result()])

    expect(table).toContain('| music | vad | 0.200 | 0 | 1/10 | 1 | boilerplate 2 |')
  })

  it('差が無ければ値だけにする', () => {
    const table = formatComparison([result()], [result()])

    expect(table).toContain('| meeting | vad | 0.200 | 0 | 1/10 | 1 | boilerplate 2 |')
  })
})

describe('environmentDifferences', () => {
  it('基準と違う条件を挙げる（音声や whisper が違えば数値は比べられない）', () => {
    expect(environmentDifferences(environment, { ...environment, macos: '15.5', voices: ['Kyoko', 'Reed'] })).toEqual([
      'macos: 15.5 → 26.0',
      'voices: Kyoko, Reed → Kyoko'
    ])
  })
})
