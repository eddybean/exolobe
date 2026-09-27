import { describe, expect, it } from 'vitest'
import { combinedLevel } from '@renderer/session/readInputLevel'

/**
 * 音量メーターが「録音として何か拾えているか」を表すものである以上、
 * マイクとデスクトップ音声のどちらが鳴っていても振れる必要がある。
 * その方針をフックから切り離してここで固定する。
 * トラックごとの読み取り（取得の失敗を無音にする）は live-notes.test.ts の readTrackLevels。
 */
describe('combinedLevel', () => {
  it('マイクとデスクトップ音声の大きい方を返す', () => {
    expect(combinedLevel({ mic: 0.2, system: 0.7 })).toBe(0.7)
    expect(combinedLevel({ mic: 0.9, system: 0.1 })).toBe(0.9)
  })

  it('マイクが取れていなくてもデスクトップ音声だけで振れる', () => {
    expect(combinedLevel({ mic: undefined, system: 0.4 })).toBe(0.4)
  })
})
