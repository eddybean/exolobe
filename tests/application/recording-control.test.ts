import { beforeEach, describe, expect, it } from 'vitest'
import { StartRecording } from '@application/usecases/StartRecording'
import { StopRecording } from '@application/usecases/StopRecording'
import { defaultSettings } from '@domain/Settings'
import {
  FakeArtifactStore,
  FakeAudioCapture,
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

  const deps = {
    settings,
    repository,
    capture,
    artifacts,
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
    const recording = await ctx.start.execute({ title: 'チーム定例' })

    expect(recording.status).toBe('recording')
    expect(recording.slug).toBe('2026-09-06_1430_チーム定例')
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
      '保存先が設定されていません。設定画面から保存先を選んでください。'
    )
    expect(ctxUnconfigured.capture.isActive()).toBe(false)
  })

  it('すでに録音中なら二重に開始しない', async () => {
    await ctx.start.execute({})
    await expect(ctx.start.execute({})).rejects.toThrow('すでに録音中です。')
    expect(ctx.capture.startCalls).toHaveLength(1)
  })

  it('キャプチャ開始に失敗したら録音を残さない', async () => {
    ctx.capture.startError = new Error('システム音声の録音が許可されていません。')

    await expect(ctx.start.execute({})).rejects.toThrow('システム音声の録音が許可されていません。')
    expect(await ctx.repository.list()).toEqual([])
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
    await expect(ctx.stop.execute('rec-1')).rejects.toThrow('録音中ではありません。')
  })

  it('存在しない録音 ID なら停止できない', async () => {
    await ctx.start.execute({})
    await expect(ctx.stop.execute('unknown')).rejects.toThrow('録音が見つかりません: unknown')
  })
})
