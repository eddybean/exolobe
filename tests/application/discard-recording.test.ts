import { describe, expect, it } from 'vitest'
import { DiscardRecording } from '@application/usecases/DiscardRecording'
import { StartRecording } from '@application/usecases/StartRecording'
import {
  FakeArtifactStore,
  FakeAudioCapture,
  FakeCalendar,
  FakeClock,
  FakeIdGenerator,
  FakeRecordingRepository,
  FakeSettingsRepository
} from './fakes'

/**
 * 「停止して破棄」（ADR-041）。自動で始まった録音が録ってはいけない会議だったとき、
 * パイプラインにかけずに痕跡ごと消す。
 */
const build = () => {
  const deps = {
    settings: new FakeSettingsRepository(),
    repository: new FakeRecordingRepository(),
    capture: new FakeAudioCapture(),
    artifacts: new FakeArtifactStore(),
    calendar: new FakeCalendar(),
    clock: new FakeClock(new Date('2026-09-27T10:00:00+09:00')),
    ids: new FakeIdGenerator()
  }
  return { ...deps, start: new StartRecording(deps), discard: new DiscardRecording(deps) }
}

describe('DiscardRecording', () => {
  it('キャプチャを止め、録音のファイルと一覧の記録を消す', async () => {
    const ctx = build()
    const recording = await ctx.start.execute({})

    await ctx.discard.execute(recording.id)

    expect(ctx.capture.isActive()).toBe(false)
    expect(ctx.artifacts.removed).toEqual([recording.id])
    expect(await ctx.repository.list()).toEqual([])
  })

  it('トラック情報を書き残さない（再起動後に処理が再開されないように）', async () => {
    const ctx = build()
    const recording = await ctx.start.execute({})

    await ctx.discard.execute(recording.id)

    expect(ctx.artifacts.tracks.size).toBe(0)
  })

  it('録音中でなければ破棄できない', async () => {
    const ctx = build()

    await expect(ctx.discard.execute('rec-1')).rejects.toThrow('録音中ではありません。')
  })
})
