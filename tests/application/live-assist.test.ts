import { beforeEach, describe, expect, it } from 'vitest'
import {
  LiveAssistSession,
  type LiveAssistFeatures,
  type LiveAssistListener,
  type LiveAssistStatus,
  type LiveSuggestion
} from '@application/usecases/live-assist'
import type { CaptionEvent } from '@domain/LiveCaption'
import type { LiveHeadline } from '@domain/LiveAssistPrompt'
import { AppError } from '@domain/errors'
import { FakeClock, FakeLiveAssistModel, FakeLiveTranscription, FakePastRecordingSearch } from './fakes'

const NOW = new Date('2026-11-23T10:00:00+09:00')
const ALL: LiveAssistFeatures = { captions: true, pastRecordings: true, headlines: true }

let transcription: FakeLiveTranscription
let model: FakeLiveAssistModel
let search: FakePastRecordingSearch
let clock: FakeClock
let received: {
  captions: CaptionEvent[]
  statuses: LiveAssistStatus[]
  suggestions: LiveSuggestion[]
  headlines: LiveHeadline[]
}
let listener: LiveAssistListener

const build = (deps: { model?: boolean; search?: boolean } = {}): LiveAssistSession =>
  new LiveAssistSession({
    transcription,
    clock,
    ...(deps.model === false ? {} : { model }),
    ...(deps.search === false ? {} : { search })
  })

const begin = async (session: LiveAssistSession, features: LiveAssistFeatures = ALL): Promise<void> =>
  session.begin({
    recordingId: 'current',
    sampleRate: 16_000,
    language: 'ja',
    features,
    headlineIntervalMin: 3,
    listener
  })

const final = (text: string, startMs: number, track: CaptionEvent['track'] = 'remote'): CaptionEvent => ({
  track,
  kind: 'final',
  text,
  startMs,
  endMs: startMs + 2_000
})

/** 非同期の後始末（検索・生成）が流れ切るのを待つ。 */
const settle = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

beforeEach(() => {
  transcription = new FakeLiveTranscription()
  model = new FakeLiveAssistModel()
  search = new FakePastRecordingSearch()
  clock = new FakeClock(NOW)
  received = { captions: [], statuses: [], suggestions: [], headlines: [] }
  listener = {
    caption: (event) => received.captions.push(event),
    status: (status) => received.statuses.push(status),
    suggestion: (suggestion) => received.suggestions.push(suggestion),
    headline: (headline) => received.headlines.push(headline)
  }
})

describe('LiveAssistSession — 字幕', () => {
  it('会議の言語の認識器を録音のサンプルレートで起こし、準備ができたら running にする', async () => {
    const session = build()
    await begin(session)
    transcription.emit({ type: 'ready' })

    expect(transcription.started).toEqual({ sampleRate: 16_000, locale: 'ja-JP' })
    expect(received.statuses).toEqual([{ state: 'starting' }, { state: 'running' }])
  })

  it('英語の会議は en-US で認識する', async () => {
    const session = build()
    await session.begin({
      recordingId: 'current',
      sampleRate: 48_000,
      language: 'en',
      features: ALL,
      headlineIntervalMin: 3,
      listener
    })

    expect(transcription.started).toEqual({ sampleRate: 48_000, locale: 'en-US' })
  })

  it('初回のモデル取得中はそう知らせる', async () => {
    const session = build()
    await begin(session)
    transcription.emit({ type: 'downloading' })

    expect(received.statuses.at(-1)).toEqual({ state: 'downloading' })
  })

  it('認識器が起動できなくても例外にせず、使えない理由を知らせる（録音は続ける）', async () => {
    transcription.startError = new Error('spawn ENOENT')
    const session = build()

    await expect(begin(session)).resolves.toBeUndefined()
    expect(received.statuses.at(-1)).toEqual({ state: 'unavailable', reason: 'crashed' })
  })

  it('途中で止まったら理由を知らせる', async () => {
    const session = build()
    await begin(session)
    transcription.emit({ type: 'failed', reason: 'unsupported-locale' })

    expect(received.statuses.at(-1)).toEqual({ state: 'unavailable', reason: 'unsupported-locale' })
  })

  it('字幕を有効にしていれば認識の結果を画面へ渡す', async () => {
    const session = build()
    await begin(session)
    transcription.caption(final('それでは始めます。', 0))

    expect(received.captions).toEqual([final('それでは始めます。', 0)])
  })

  it('字幕を切っていれば画面へは渡さないが、見出しのために認識は続ける', async () => {
    const session = build()
    await begin(session, { captions: false, pastRecordings: false, headlines: true })
    transcription.caption(final('それでは始めます。', 0))

    expect(transcription.started).toBeDefined()
    expect(received.captions).toEqual([])
  })

  it('どの機能も使わないなら認識器を起こさない', async () => {
    const session = build()
    await begin(session, { captions: false, pastRecordings: false, headlines: false })

    expect(transcription.started).toBeUndefined()
    expect(received.statuses).toEqual([{ state: 'off' }])
  })

  it('録音の PCM を認識器へ流し、止めた後は流さない', async () => {
    const session = build()
    await begin(session)
    session.push('remote', new Uint8Array(3_200))
    session.push('self', new Uint8Array(1_600))
    await session.end()
    session.push('remote', new Uint8Array(3_200))

    expect(transcription.pushes).toEqual([
      { track: 'remote', bytes: 3_200 },
      { track: 'self', bytes: 1_600 }
    ])
  })

  it('止めるのは何度呼んでも 1 回だけで、状態を off に戻す', async () => {
    const session = build()
    await begin(session)
    await session.end()
    await session.end()

    expect(transcription.stops).toBe(1)
    expect(received.statuses.at(-1)).toEqual({ state: 'off' })
  })
})

describe('LiveAssistSession — 過去の録音の提示', () => {
  beforeEach(() => {
    search.hits = [
      {
        recordingId: 'current',
        title: '今の会議',
        startedAt: NOW,
        excerpt: '今のログイン画面のバグ',
        startMs: 10_000
      },
      {
        recordingId: 'old',
        title: '先々月の定例',
        startedAt: new Date('2026-09-10T10:00:00+09:00'),
        excerpt: 'ログイン画面のバグ（古い）',
        startMs: 5_000
      },
      {
        recordingId: 'last-week',
        title: '先週の定例',
        startedAt: new Date('2026-11-18T10:00:00+09:00'),
        excerpt: 'ログイン画面のバグはセッションの期限が原因',
        startMs: 120_000
      }
    ]
  })

  it('過去を指す発言の話題語で探し、期間に入る別の録音の箇所を 1 件出す', async () => {
    const session = build()
    await begin(session)
    transcription.caption(final('まず先週話していたログイン画面のバグの件ですが、', 0))
    await settle()

    expect(search.calls).toEqual([{ query: 'ログイン画面のバグ', limit: 10 }])
    expect(received.suggestions).toEqual([
      {
        recordingId: 'last-week',
        title: '先週の定例',
        startedAt: new Date('2026-11-18T10:00:00+09:00'),
        excerpt: 'ログイン画面のバグはセッションの期限が原因',
        startMs: 120_000,
        rangeLabel: '先週（11/16〜11/22）'
      }
    ])
  })

  it('自分の発言でも拾う', async () => {
    const session = build()
    await begin(session)
    transcription.caption(final('先週話していたログイン画面のバグの件ですが', 0, 'self'))
    await settle()

    expect(received.suggestions).toHaveLength(1)
  })

  it('過去を指さない発言では探さない', async () => {
    const session = build()
    await begin(session)
    transcription.caption(final('来月のリリースの件ですが', 0))
    await settle()

    expect(search.calls).toEqual([])
  })

  it('書きかけの字幕では探さない', async () => {
    const session = build()
    await begin(session)
    transcription.caption({ ...final('先週話していたログイン画面のバグの件', 0), kind: 'volatile' })
    await settle()

    expect(search.calls).toEqual([])
  })

  it('検索が失敗しても例外にせず、何も出さない', async () => {
    search.error = new Error('worker crashed')
    const session = build()
    await begin(session)
    transcription.caption(final('先週話していたログイン画面のバグの件ですが', 0))
    await settle()

    expect(received.suggestions).toEqual([])
  })

  it('意味検索が使えなければ探さない', async () => {
    const session = build({ search: false })
    await begin(session)
    transcription.caption(final('先週話していたログイン画面のバグの件ですが', 0))
    await settle()

    expect(received.suggestions).toEqual([])
  })

  it('閉じた録音は同じ録音中にもう出さない', async () => {
    const session = build()
    await begin(session)
    transcription.caption(final('先週話していたログイン画面のバグの件ですが', 0))
    await settle()
    session.dismissSuggestion('last-week')

    clock.advance(600_000)
    transcription.caption(final('先週話していたログイン画面の不具合の件', 600_000))
    await settle()

    expect(received.suggestions.map((suggestion) => suggestion.recordingId)).toEqual(['last-week'])
  })
})

describe('LiveAssistSession — 見出し', () => {
  const talk = (seconds: number): void => {
    for (let index = 0; index < seconds / 10; index += 1) {
      transcription.caption(final('決済まわりのテストが終わっていないので二十二日に後ろ倒しにします。', index * 10_000))
    }
  }

  it('間隔が経ち確定文が十分にあれば、話者の印を付けた字幕から見出しを作る', async () => {
    model.replies = ['見出し: リリース日程\n- 22日に後ろ倒し']
    const session = build()
    await begin(session)
    talk(180)
    clock.advance(180_000)
    await session.tick()

    expect(model.prompts[0]).toContain('[相手] 決済まわりのテスト')
    expect(received.headlines).toEqual([{ title: 'リリース日程', points: ['22日に後ろ倒し'] }])
  })

  it('間隔の前は作らない', async () => {
    const session = build()
    await begin(session)
    talk(60)
    clock.advance(60_000)
    await session.tick()

    expect(model.prompts).toEqual([])
  })

  it('作ったら次の間隔まで作らない', async () => {
    model.replies = ['見出し: A', '見出し: B']
    const session = build()
    await begin(session)
    talk(180)
    clock.advance(180_000)
    await session.tick()
    await session.tick()

    expect(model.prompts).toHaveLength(1)
  })

  it('見出しを切っていれば作らない', async () => {
    const session = build()
    await begin(session, { captions: true, pastRecordings: true, headlines: false })
    talk(180)
    clock.advance(180_000)
    await session.tick()

    expect(model.prompts).toEqual([])
  })

  it('生成に失敗しても、読めない出力でも何も出さない', async () => {
    model.error = new Error('applelm failed')
    const session = build()
    await begin(session)
    talk(180)
    clock.advance(180_000)
    await expect(session.tick()).resolves.toBeUndefined()

    model.error = undefined
    model.replies = ['分かりません']
    talk(180)
    clock.advance(180_000)
    await session.tick()

    expect(received.headlines).toEqual([])
  })
})

describe('LiveAssistSession — ここまでの要約と ToDo', () => {
  it('ここまでの字幕を要約する', async () => {
    model.replies = ['- 日程は22日\n- 障害を調査']
    const session = build()
    await begin(session)
    transcription.caption(final('二十二日に後ろ倒しにします。', 0))
    transcription.caption(final('障害の影響範囲を調べます。', 3_000, 'self'))

    await expect(session.summarize()).resolves.toEqual(['日程は22日', '障害を調査'])
    expect(model.prompts[0]).toContain('[相手] 二十二日に後ろ倒しにします。\n[自分] 障害の影響範囲を調べます。')
  })

  it('ToDo と決定事項の候補を出す', async () => {
    model.replies = ['ToDo: 影響範囲を調べる（自分）\n決定: リリースは22日']
    const session = build()
    await begin(session)
    transcription.caption(final('二十二日に後ろ倒しにします。', 0))

    await expect(session.extractActions()).resolves.toEqual([
      { kind: 'todo', text: '影響範囲を調べる（自分）' },
      { kind: 'decision', text: 'リリースは22日' }
    ])
  })

  it('まだ何も確定していなければ、モデルを呼ばずに空を返す', async () => {
    const session = build()
    await begin(session)

    await expect(session.summarize()).resolves.toEqual([])
    await expect(session.extractActions()).resolves.toEqual([])
    expect(model.prompts).toEqual([])
  })

  it('Apple Intelligence が無ければ理由つきで断る', async () => {
    const session = build({ model: false })
    await begin(session)
    transcription.caption(final('二十二日に後ろ倒しにします。', 0))

    await expect(session.summarize()).rejects.toBeInstanceOf(AppError)
  })
})
