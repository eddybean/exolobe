import { beforeEach, describe, expect, it } from 'vitest'
import { StartRecording } from '@application/usecases/StartRecording'
import { StopRecording } from '@application/usecases/StopRecording'
import type { CalendarEvent } from '@domain/CalendarEvent'
import { defaultSettings } from '@domain/Settings'
import {
  FakeArtifactStore,
  FakeAudioCapture,
  FakeCalendar,
  FakeClock,
  FakeIdGenerator,
  FakeRecordingRepository,
  FakeSettingsRepository
} from './fakes'

const startedAt = new Date('2026-09-06T14:30:00+09:00')

const build = (settings = new FakeSettingsRepository()) => {
  const repository = new FakeRecordingRepository()
  const capture = new FakeAudioCapture()
  const artifacts = new FakeArtifactStore()
  const clock = new FakeClock(startedAt)
  const calendar = new FakeCalendar()

  const deps = {
    settings,
    repository,
    capture,
    artifacts,
    calendar,
    clock,
    ids: new FakeIdGenerator()
  }

  return {
    ...deps,
    start: new StartRecording(deps),
    stop: new StopRecording(deps)
  }
}

describe('StartRecording', () => {
  let ctx: ReturnType<typeof build>

  beforeEach(() => {
    ctx = build()
  })

  it('録音を作成して保存し、キャプチャを開始する', async () => {
    const recording = await ctx.start.execute({ title: 'サンプル会議' })

    expect(recording.status).toBe('recording')
    expect(recording.slug).toBe('2026-09-06_1430-rec-1')
    expect(ctx.capture.isActive()).toBe(true)
    expect(await ctx.repository.find(recording.id)).toEqual(recording)
  })

  it('設定のサンプルレートと録音専用の作業ディレクトリを渡す', async () => {
    const recording = await ctx.start.execute({})

    expect(ctx.capture.startCalls).toEqual([
      { workDir: ctx.artifacts.workDir(recording), sampleRate: 16_000 }
    ])
  })

  it('保存先が未設定なら開始できない', async () => {
    const ctxUnconfigured = build(new FakeSettingsRepository(defaultSettings()))

    await expect(ctxUnconfigured.start.execute({})).rejects.toThrow(
      'storageNotConfigured'
    )
    expect(ctxUnconfigured.capture.isActive()).toBe(false)
  })

  it('すでに録音中なら二重に開始しない', async () => {
    await ctx.start.execute({})
    await expect(ctx.start.execute({})).rejects.toThrow('alreadyRecording')
    expect(ctx.capture.startCalls).toHaveLength(1)
  })

  it('キャプチャ開始に失敗したら録音を残さない', async () => {
    ctx.capture.startError = new Error('システム音声の録音が許可されていません。')

    await expect(ctx.start.execute({})).rejects.toThrow('システム音声の録音が許可されていません。')
    expect(await ctx.repository.list()).toEqual([])
  })
})

describe('StartRecording（カレンダー連携）', () => {
  let ctx: ReturnType<typeof build>

  const meeting: CalendarEvent = {
    title: '週次定例',
    startsAt: new Date('2026-09-06T14:30:00+09:00'),
    endsAt: new Date('2026-09-06T15:00:00+09:00'),
    allDay: false,
    attendees: [
      { name: '自分', isSelf: true, status: 'accepted', kind: 'person' },
      { name: '山田 太郎', isSelf: false, status: 'accepted', kind: 'person' }
    ]
  }

  const withCalendar = (enabled: boolean) =>
    new FakeSettingsRepository({
      ...defaultSettings(),
      storageDir: '/storage',
      recording: { ...defaultSettings().recording, calendarEnabled: enabled }
    })

  beforeEach(() => {
    ctx = build(withCalendar(true))
    ctx.calendar.events = [meeting]
  })

  it('重なる予定のタイトルを録音タイトルにし、参加者名を残す', async () => {
    const recording = await ctx.start.execute({})

    expect(recording.title).toBe('週次定例')
    expect(recording.participants).toEqual(['山田 太郎'])
    expect(await ctx.repository.find(recording.id)).toEqual(recording)
  })

  it('開始時刻から少し先までに重なる予定を問い合わせる', async () => {
    await ctx.start.execute({})

    expect(ctx.calendar.calls).toEqual([
      { from: startedAt, to: new Date(startedAt.getTime() + 5 * 60_000) }
    ])
  })

  it('タイトルが指定されていればそちらを優先し、参加者名は残す', async () => {
    const recording = await ctx.start.execute({ title: '手で付けた名前' })

    expect(recording.title).toBe('手で付けた名前')
    expect(recording.participants).toEqual(['山田 太郎'])
  })

  it('重なる予定が無ければ従来どおりの既定タイトルになる', async () => {
    ctx.calendar.events = []

    const recording = await ctx.start.execute({})

    expect(recording.title).toBe('2026-09-06 14:30 の会議')
    expect(recording.participants).toBeUndefined()
  })

  it('設定で無効ならカレンダーを問い合わせない', async () => {
    ctx = build(withCalendar(false))

    const recording = await ctx.start.execute({})

    expect(ctx.calendar.calls).toEqual([])
    expect(recording.title).toBe('2026-09-06 14:30 の会議')
  })

  it('カレンダーの問い合わせに失敗しても録音は始まる', async () => {
    ctx.calendar.error = new Error('EventKit に接続できません')

    const recording = await ctx.start.execute({})

    expect(recording.title).toBe('2026-09-06 14:30 の会議')
    expect(await ctx.repository.find(recording.id)).toEqual(recording)
  })

  it('予定の応答を待たずにキャプチャを始める', async () => {
    let release = (): void => {}
    ctx.calendar.gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const pending = ctx.start.execute({})
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ctx.capture.isActive()).toBe(true)

    release()
    expect((await pending).title).toBe('週次定例')
  })
})

describe('StopRecording', () => {
  let ctx: ReturnType<typeof build>

  beforeEach(() => {
    ctx = build()
  })

  it('録音時間を確定して処理中に遷移させ、トラック情報を返す', async () => {
    const started = await ctx.start.execute({})
    const result = await ctx.stop.execute(started.id)

    expect(result.recording.status).toBe('processing')
    expect(result.recording.durationMs).toBe(65_000)
    expect(result.tracks).toEqual(ctx.capture.tracks)
    expect(ctx.capture.isActive()).toBe(false)
  })

  it('遷移後の状態を永続化する', async () => {
    const started = await ctx.start.execute({})
    await ctx.stop.execute(started.id)

    expect((await ctx.repository.find(started.id))?.status).toBe('processing')
  })

  it('録音中でなければ停止できない', async () => {
    await expect(ctx.stop.execute('rec-1')).rejects.toThrow('notRecording')
  })

  it('存在しない録音 ID なら停止できない', async () => {
    await ctx.start.execute({})
    await expect(ctx.stop.execute('unknown')).rejects.toThrow('recordingNotFound')
  })
})
