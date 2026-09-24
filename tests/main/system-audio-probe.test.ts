import { describe, expect, it } from 'vitest'
import { probeSystemAudio } from '../../src/main/systemAudioProbe'
import type { SystemAudioSource } from '@infrastructure/audio/DualTrackRecorder'

/** 16bit PCM で、指定した振幅（0〜1）の 1 サンプルだけを持つチャンク。 */
const pcm = (amplitude: number): Buffer => {
  const buffer = Buffer.alloc(2)
  buffer.writeInt16LE(Math.round(amplitude * 32_767))
  return buffer
}

const fakeSource = (chunks: Buffer[], options: { error?: Error } = {}) => {
  const calls: string[] = []
  let onData: (pcm: Buffer) => void = () => undefined
  let onError: (error: Error) => void = () => undefined
  const source: SystemAudioSource = {
    onData: (listener) => void (onData = listener),
    onError: (listener) => void (onError = listener),
    start: async () => {
      calls.push('start')
    },
    stop: async () => {
      calls.push('stop')
    }
  }
  // 待っている間に届いたことにする。
  const wait = async (): Promise<void> => {
    for (const chunk of chunks) onData(chunk)
    if (options.error) onError(options.error)
  }
  return { source, wait, calls }
}

describe('probeSystemAudio', () => {
  it('待っている間に届いた音の最大の大きさを返す', async () => {
    const { source, wait } = fakeSource([pcm(0), pcm(0.15), pcm(0.05)])

    const peak = await probeSystemAudio({ source, durationMs: 3000, wait })

    expect(peak).toBeCloseTo(0.15, 2)
  })

  it('終わったら必ず止める（見張りや次の録音と取り合わない）', async () => {
    const { source, wait, calls } = fakeSource([pcm(0.1)])

    await probeSystemAudio({ source, durationMs: 3000, wait })

    expect(calls).toEqual(['start', 'stop'])
  })

  it('取り込み中のエラーは投げ、それでも止める', async () => {
    const { source, wait, calls } = fakeSource([], { error: new Error('tap failed') })

    await expect(probeSystemAudio({ source, durationMs: 3000, wait })).rejects.toThrow('tap failed')
    expect(calls).toEqual(['start', 'stop'])
  })
})
