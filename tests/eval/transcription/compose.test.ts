import { describe, expect, it } from 'vitest'
import { composeScenario, SAMPLE_RATE } from './compose'

/** 読み上げの代わり。1 文字 0.1 秒、振幅 0.5 の一定の音。 */
const fakeSpeech = (text: string): Float32Array => new Float32Array(text.length * (SAMPLE_RATE / 10)).fill(0.5)

describe('composeScenario', () => {
  it('発話と間を順に並べ、発話の時刻を正解として返す', () => {
    const { samples, said } = composeScenario(
      [
        { kind: 'speech', text: 'あいうえお', voice: 'Kyoko' },
        { kind: 'gap', seconds: 2, noise: { type: 'fan', level: 0.01 } },
        { kind: 'speech', text: 'かきく', voice: 'Kyoko' }
      ],
      fakeSpeech
    )

    expect(said).toEqual([
      { startMs: 0, endMs: 500, text: 'あいうえお' },
      { startMs: 2500, endMs: 2800, text: 'かきく' }
    ])
    expect(samples.length).toBe(2.8 * SAMPLE_RATE)
  })

  it('重なった発話は、下に敷いた声も遅れた位置で正解に入れる', () => {
    const { said } = composeScenario(
      [
        {
          kind: 'overlap',
          main: { text: 'あいうえおかきくけこ', voice: 'Reed' },
          under: { text: 'さしすせそ', voice: 'Kyoko', gain: 0.5, delaySeconds: 0.4 }
        }
      ],
      fakeSpeech
    )

    expect(said).toEqual([
      { startMs: 0, endMs: 1000, text: 'あいうえおかきくけこ' },
      { startMs: 400, endMs: 900, text: 'さしすせそ' }
    ])
  })

  it('同じ台本からは同じ音ができる（雑音も乱数の種で決まる）', () => {
    const parts = [
      { kind: 'gap', seconds: 1, noise: { type: 'keyboard', level: 0.05 } },
      { kind: 'speech', text: 'あ', voice: 'Kyoko', noise: { type: 'fan', level: 0.01 } }
    ] as const

    expect(composeScenario(parts, fakeSpeech).samples).toEqual(composeScenario(parts, fakeSpeech).samples)
  })
})
