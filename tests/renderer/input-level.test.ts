import { describe, expect, it } from 'vitest'
import { readInputLevel } from '@renderer/session/readInputLevel'

/**
 * 音量メーターが「録音として何か拾えているか」を表すものである以上、
 * マイクとデスクトップ音声のどちらが鳴っていても振れる必要がある。
 * その方針をフックから切り離してここで固定する。
 */
describe('readInputLevel', () => {
  it('マイクとデスクトップ音声の大きい方を返す', async () => {
    await expect(readInputLevel({ micLevel: () => 0.2, systemLevel: async () => 0.7 })).resolves.toBe(
      0.7
    )
    await expect(readInputLevel({ micLevel: () => 0.9, systemLevel: async () => 0.1 })).resolves.toBe(
      0.9
    )
  })

  it('マイクが取れていなくてもデスクトップ音声だけで振れる', async () => {
    await expect(readInputLevel({ micLevel: undefined, systemLevel: async () => 0.4 })).resolves.toBe(
      0.4
    )
  })

  it('デスクトップ音声のレベル取得に失敗してもマイク側の表示は止めない', async () => {
    const level = await readInputLevel({
      micLevel: () => 0.3,
      systemLevel: async () => {
        throw new Error('録音中ではありません。')
      }
    })

    expect(level).toBe(0.3)
  })
})
