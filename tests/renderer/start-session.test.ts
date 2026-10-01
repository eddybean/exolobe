import { describe, expect, it, vi } from 'vitest'
import { startRecordingSession } from '@renderer/session/startRecordingSession'
import type { MicCapture } from '@renderer/audio/micCapture'

const fakeMic = (): MicCapture => ({
  level: () => 0,
  stop: async () => undefined
})

const build = (
  overrides: {
    startRecording?: () => Promise<void>
    startMic?: () => Promise<MicCapture>
    stopRecording?: () => Promise<void>
  } = {}
) => {
  const calls: string[] = []

  const api = {
    startRecording: vi.fn(async (): Promise<void> => {
      calls.push('startRecording')
      await overrides.startRecording?.()
    }),
    stopRecording: vi.fn(async (): Promise<void> => {
      calls.push('stopRecording')
      await overrides.stopRecording?.()
    }),
    pushMicPcm: vi.fn()
  }

  const startMic = vi.fn(
    async (_options: { sampleRate: number; onPcm: (pcm: ArrayBuffer) => void }): Promise<MicCapture> => {
      calls.push('startMic')
      return overrides.startMic ? overrides.startMic() : fakeMic()
    }
  )

  return { api, startMic, calls }
}

describe('startRecordingSession', () => {
  it('録音を開始してからマイクを取得する', async () => {
    const ctx = build()

    const outcome = await startRecordingSession({
      title: 'サンプル会議',
      sampleRate: 16_000,
      api: ctx.api,
      startMic: ctx.startMic
    })

    expect(ctx.calls).toEqual(['startRecording', 'startMic'])
    expect(ctx.api.startRecording).toHaveBeenCalledWith('サンプル会議')
    expect(outcome.micCapture).toBeDefined()
    expect(outcome.warning).toBeUndefined()
  })

  it('設定のサンプルレートでマイクを開始する', async () => {
    const ctx = build()

    await startRecordingSession({ sampleRate: 48_000, api: ctx.api, startMic: ctx.startMic })

    expect(ctx.startMic).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 48_000 }))
  })

  it('マイクの PCM を main へ転送する', async () => {
    let forward: ((pcm: ArrayBuffer) => void) | undefined
    const ctx = build()
    ctx.startMic.mockImplementation(async (options) => {
      forward = options.onPcm
      return fakeMic()
    })

    await startRecordingSession({ sampleRate: 16_000, api: ctx.api, startMic: ctx.startMic })

    const pcm = new ArrayBuffer(8)
    forward?.(pcm)

    expect(ctx.api.pushMicPcm).toHaveBeenCalledWith(pcm)
  })

  describe('マイクの取得に失敗したとき', () => {
    const micDenied = () => {
      throw new Error('マイクを使用できませんでした。')
    }

    it('録音は止めずに継続する', async () => {
      const ctx = build({ startMic: async () => micDenied() })

      await startRecordingSession({ sampleRate: 16_000, api: ctx.api, startMic: ctx.startMic })

      // デスクトップ音声だけでも会議相手の発言は残るため、録音を捨てない
      expect(ctx.api.stopRecording).not.toHaveBeenCalled()
      expect(ctx.calls).toEqual(['startRecording', 'startMic'])
    })

    it('例外を投げず、警告として理由を返す', async () => {
      const ctx = build({ startMic: async () => micDenied() })

      const outcome = await startRecordingSession({
        sampleRate: 16_000,
        api: ctx.api,
        startMic: ctx.startMic
      })

      expect(outcome.micCapture).toBeUndefined()
      expect(outcome.warning).toContain('マイクを使用できませんでした。')
      expect(outcome.warning).toContain('相手の音声のみ')
    })
  })

  it('録音自体の開始に失敗したらマイクを取得せず例外を投げる', async () => {
    const ctx = build({
      startRecording: async () => {
        throw new Error('システム音声の録音が許可されていません。')
      }
    })

    await expect(startRecordingSession({ sampleRate: 16_000, api: ctx.api, startMic: ctx.startMic })).rejects.toThrow(
      'システム音声の録音が許可されていません。'
    )

    expect(ctx.startMic).not.toHaveBeenCalled()
    expect(ctx.api.stopRecording).not.toHaveBeenCalled()
  })

  it('タイトル未指定なら undefined を渡す（main 側で既定値を付ける）', async () => {
    const ctx = build()

    await startRecordingSession({ sampleRate: 16_000, api: ctx.api, startMic: ctx.startMic })

    expect(ctx.api.startRecording).toHaveBeenCalledWith(undefined)
  })
})
