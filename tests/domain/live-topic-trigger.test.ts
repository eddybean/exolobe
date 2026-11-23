import { describe, expect, it } from 'vitest'
import {
  detectPastReference,
  initialTopicTrigger,
  pickSuggestion,
  recordSearch,
  recordSuggestion,
  shouldSearch,
  type SuggestionCandidate,
  type TopicTriggerOptions
} from '@domain/LiveTopicTrigger'

const NOW = new Date('2026-11-23T10:00:00+09:00')
const at = (iso: string): number => new Date(iso).getTime()

describe('detectPastReference', () => {
  it('「先週話していたバグの件」から先週の期間と話題語を取る', () => {
    const found = detectPastReference(
      'まず先週話していたログイン画面のバグの件ですが、原因はセッションの有効期限でした。',
      NOW
    )

    expect(found).toEqual({
      topic: 'ログイン画面のバグ',
      range: { fromMs: at('2026-11-16T00:00:00+09:00'), toMs: at('2026-11-23T00:00:00+09:00') },
      rangeLabel: '先週（11/16〜11/22）'
    })
  })

  it('「前回」は期間を持たず、話題語だけを取る', () => {
    expect(detectPastReference('前回の定例で話していた監視の設定の件も、見直しておきます。', NOW)).toEqual({
      topic: '監視の設定'
    })
  })

  it('「先月の〜の話」も拾う', () => {
    expect(detectPastReference('先月の採用面接の話ですが、', NOW)?.topic).toBe('採用面接')
  })

  it('過去を指す語が無ければ拾わない（今の議題の「〜の件」）', () => {
    expect(detectPastReference('来月のリリースの件ですが、日程を相談させてください。', NOW)).toBeUndefined()
  })

  it('「今日」は今の会議なので過去として扱わない', () => {
    expect(detectPastReference('今日話していた件ですが', NOW)).toBeUndefined()
  })

  it('過去の語があっても、話題を指す語が無ければ拾わない（雑談）', () => {
    expect(detectPastReference('昨日は雨がひどかったですね。', NOW)).toBeUndefined()
  })

  it('話題語が短すぎれば拾わない', () => {
    expect(detectPastReference('前回の件ですが', NOW)).toBeUndefined()
  })

  it('複数の文があれば、過去を指す文だけを見る', () => {
    expect(
      detectPastReference('ありがとうございます。この前の打ち合わせで出た見積もりの件、どうなりました？', NOW)?.topic
    ).toBe('見積もり')
  })
})

const options: TopicTriggerOptions = { minSuggestionIntervalMs: 180_000, minSearchIntervalMs: 30_000 }

describe('頻度の制御', () => {
  it('同じ話題語では録音中に 1 回しか検索しない', () => {
    const state = recordSearch(initialTopicTrigger(), { topic: 'ログイン画面のバグ', nowMs: 0 })

    expect(shouldSearch(state, { topic: 'ログイン画面のバグ', nowMs: 600_000 }, options)).toBe(false)
    expect(shouldSearch(state, { topic: '監視の設定', nowMs: 600_000 }, options)).toBe(true)
  })

  it('検索は 30 秒に 1 回まで', () => {
    const state = recordSearch(initialTopicTrigger(), { topic: 'A の件', nowMs: 0 })

    expect(shouldSearch(state, { topic: 'B の件', nowMs: 29_999 }, options)).toBe(false)
    expect(shouldSearch(state, { topic: 'B の件', nowMs: 30_000 }, options)).toBe(true)
  })

  it('提示は 3 分に 1 回まで', () => {
    const hit: SuggestionCandidate = { recordingId: 'r1', startMs: 1_000 }
    const state = recordSuggestion(initialTopicTrigger(), { candidate: hit, nowMs: 0 })

    expect(shouldSearch(state, { topic: '別の話題', nowMs: 179_999 }, options)).toBe(false)
    expect(shouldSearch(state, { topic: '別の話題', nowMs: 180_000 }, options)).toBe(true)
  })

  it('一度出した録音の同じ箇所は出さず、次の候補を選ぶ', () => {
    const shown: SuggestionCandidate = { recordingId: 'r1', startMs: 1_000 }
    const state = recordSuggestion(initialTopicTrigger(), { candidate: shown, nowMs: 0 })

    expect(
      pickSuggestion(state, [shown, { recordingId: 'r1', startMs: 60_000 }, { recordingId: 'r2', startMs: 0 }])
    ).toEqual({ recordingId: 'r1', startMs: 60_000 })
    expect(pickSuggestion(state, [shown])).toBeUndefined()
  })

  it('閉じた（× を押した）録音は、その録音中にもう出さない', () => {
    const state = recordSuggestion(initialTopicTrigger(), {
      candidate: { recordingId: 'r1', startMs: 1_000 },
      nowMs: 0,
      dismissed: true
    })

    expect(pickSuggestion(state, [{ recordingId: 'r1', startMs: 60_000 }])).toBeUndefined()
  })
})
