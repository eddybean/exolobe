import { describe, expect, it } from 'vitest'
import { runInputCheck } from '@renderer/session/runInputCheck'
import type { MicCapture } from '@renderer/audio/micCapture'

const build = (
  options: {
    micLevel?: number
    micError?: Error
    systemPeak?: number
    systemError?: Error
  } = {}
) => {
  const calls: string[] = []
  const mic: MicCapture = {
    level: () => options.micLevel ?? 0,
    stop: async () => void calls.push('mic.stop')
  }
  const deps = {
    startMic: async (): Promise<MicCapture> => {
      calls.push('mic.start')
      if (options.micError) throw options.micError
      return mic
    },
    probeSystemAudio: async (durationMs: number): Promise<number> => {
      calls.push(`probe:${durationMs}`)
      if (options.systemError) throw options.systemError
      return options.systemPeak ?? 0
    },
    playTone: () => {
      calls.push('tone.play')
      return { stop: () => void calls.push('tone.stop') }
    },
    wait: async (): Promise<void> => undefined,
    // 呼ばれたらすぐ 1 回だけ測る。実際は一定間隔で繰り返す。
    every: (_ms: number, tick: () => void) => {
      tick()
      return () => void calls.push('poll.stop')
    }
  }
  return { deps, calls }
}

/**
 * テスト録音。マイクとシステム音声を同時に取り、途中でアプリが確認音を鳴らす。
 * 確認音が取れたかでシステム音声の許可を見分け、マイクは入力があったかを見る。
 */
describe('runInputCheck', () => {
  it('両方に音が入れば両方「入った」', async () => {
    const { deps } = build({ micLevel: 0.2, systemPeak: 0.15 })

    expect(await runInputCheck(deps)).toEqual({
      system: { kind: 'heard' },
      mic: { kind: 'heard' }
    })
  })

  it('システム音声が無音なら「入らなかった」（許可が無いときの形）', async () => {
    const { deps } = build({ micLevel: 0.2, systemPeak: 0 })

    expect((await runInputCheck(deps)).system).toEqual({ kind: 'silent' })
  })

  it('マイクが取れなくても、システム音声のテストは続ける', async () => {
    const { deps } = build({ micError: new Error('マイクの使用が許可されていません。'), systemPeak: 0.15 })

    expect(await runInputCheck(deps)).toEqual({
      system: { kind: 'heard' },
      mic: { kind: 'error', message: 'マイクの使用が許可されていません。' }
    })
  })

  it('システム音声のテストが失敗したら、その理由を返す', async () => {
    const { deps } = build({ micLevel: 0.2, systemError: new Error('録音中はテストできません。') })

    expect((await runInputCheck(deps)).system).toEqual({
      kind: 'error',
      message: '録音中はテストできません。'
    })
  })

  it('確認音を鳴らして止め、マイクも離す（テストの後に掴んだままにしない）', async () => {
    const { deps, calls } = build({ micLevel: 0.2, systemPeak: 0.15 })

    await runInputCheck(deps)

    expect(calls).toEqual(expect.arrayContaining(['mic.start', 'tone.play', 'tone.stop', 'poll.stop', 'mic.stop']))
    expect(calls.indexOf('tone.play')).toBeLessThan(calls.indexOf('tone.stop'))
  })
})
