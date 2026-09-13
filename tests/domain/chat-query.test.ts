import { describe, expect, it } from 'vitest'
import { hasTopic, planChatQuery } from '@domain/ChatQuery'

const NOW = new Date('2026-09-13T10:00:00+09:00')

const at = (iso: string): number => new Date(iso).getTime()

describe('planChatQuery — 期間', () => {
  it('日付の言い回しを期間に変える', () => {
    const plan = planChatQuery('先週のTODOをまとめて', NOW)

    expect(plan.range?.fromMs).toBe(at('2026-08-31T00:00:00+09:00'))
    expect(plan.range?.toMs).toBe(at('2026-09-07T00:00:00+09:00'))
    expect(plan.rangeLabel).toBe('先週（08/31〜09/06）')
  })

  it('日付の言い回しが無ければ期間で絞らない', () => {
    const plan = planChatQuery('A社との商談で決まったことは？', NOW)

    expect(plan.range).toBeUndefined()
    expect(plan.rangeLabel).toBeUndefined()
  })
})

describe('planChatQuery — 話者', () => {
  it('「自分の発言だけ」は self スコープで文字起こしを要求する', () => {
    const plan = planChatQuery('先週の自分の発言だけを要約して', NOW)

    expect(plan.speakerScope).toBe('self')
    expect(plan.needsTranscript).toBe(true)
  })

  it('「私が言ったこと」も self スコープになる', () => {
    expect(planChatQuery('私が言ったことを教えて', NOW).speakerScope).toBe('self')
  })

  it('「相手の発言」は remote スコープになる', () => {
    const plan = planChatQuery('先方の発言だけまとめて', NOW)

    expect(plan.speakerScope).toBe('remote')
    expect(plan.needsTranscript).toBe(true)
  })

  it('話者を指さなければ all で、要約だけで足りる', () => {
    const plan = planChatQuery('先週のTODOをまとめて', NOW)

    expect(plan.speakerScope).toBe('all')
    expect(plan.needsTranscript).toBe(false)
  })

  it('「そのまま」「逐語」は話者を指さなくても文字起こしを要求する', () => {
    expect(planChatQuery('先週の会議で何と言っていたか教えて', NOW).needsTranscript).toBe(true)
    expect(planChatQuery('先週の議論を逐語で見せて', NOW).needsTranscript).toBe(true)
  })
})

describe('planChatQuery — 話題語', () => {
  it('日付語と依頼の言い回しを落として話題だけを残す', () => {
    expect(planChatQuery('先週のTODOをまとめて', NOW).topic).toBe('TODO')
  })

  it('日付語も話者語も落ちれば話題は残らない', () => {
    const plan = planChatQuery('先週の自分の発言だけを要約して', NOW)

    expect(plan.topic).toBe('')
    expect(hasTopic(plan)).toBe(false)
  })

  it('固有名詞は話題として残る', () => {
    const plan = planChatQuery('A社との商談で決まったことは？', NOW)

    expect(plan.topic).toContain('A社')
    expect(hasTopic(plan)).toBe(true)
  })

  it('一文字だけの残りは話題として扱わない', () => {
    expect(hasTopic(planChatQuery('先週のをまとめて', NOW))).toBe(false)
  })

  it('問い文そのものは元のまま持ち回る', () => {
    expect(planChatQuery('先週のTODOをまとめて', NOW).question).toBe('先週のTODOをまとめて')
  })
})
