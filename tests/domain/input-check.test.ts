import { describe, expect, it } from 'vitest'
import { INPUT_CHECK, judgeInput } from '@domain/InputCheck'

/**
 * テスト録音の判定。システム音声は許可が無くてもエラーにならず、ぴったり 0 の
 * 無音が流れるだけなので、アプリが鳴らした確認音が取れたかどうかで見分ける。
 */
describe('judgeInput', () => {
  it('確認音くらいの大きさが取れれば「入った」', () => {
    expect(judgeInput(0.15)).toBe('heard')
  })

  it('許可が無いときの無音（ぴったり 0）は「入らなかった」', () => {
    expect(judgeInput(0)).toBe('silent')
  })

  it('ごく小さい雑音だけでは「入った」にしない', () => {
    expect(judgeInput(INPUT_CHECK.audibleThreshold / 2)).toBe('silent')
  })
})

describe('INPUT_CHECK', () => {
  it('確認音はテストの途中で鳴り終える（鳴っている間を必ず取り込む）', () => {
    expect(INPUT_CHECK.toneStartMs + INPUT_CHECK.toneDurationMs).toBeLessThan(
      INPUT_CHECK.durationMs
    )
  })
})
