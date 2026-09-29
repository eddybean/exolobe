import { describe, expect, it } from 'vitest'
import { barHeight, pushLevel, type LevelSample } from '@renderer/session/levelHistory'

const sample = (system: number, mic: number | undefined = 0): LevelSample => ({ system, mic })

describe('pushLevel', () => {
  it('新しいサンプルを末尾に足す', () => {
    expect(pushLevel([sample(0.1)], sample(0.2), 3)).toEqual([sample(0.1), sample(0.2)])
  })

  it('上限を超えたら古い方から捨てる', () => {
    const full = [sample(0.1), sample(0.2), sample(0.3)]
    expect(pushLevel(full, sample(0.4), 3)).toEqual([sample(0.2), sample(0.3), sample(0.4)])
  })

  it('元の配列を書き換えない', () => {
    const before = [sample(0.1)]
    pushLevel(before, sample(0.2), 3)
    expect(before).toEqual([sample(0.1)])
  })
})

/**
 * 話し声の peak は小さめに出るので、線形のままだと大半の時間が板のように低い。
 * 既存の litSegments（ライブ画面のメーター）と同じ平方根で持ち上げる。
 */
describe('barHeight', () => {
  it('無音でも最低の高さを残し、録れている印が消えないようにする', () => {
    expect(barHeight(0, 13, 0.6)).toBe(0.6)
  })

  it('最大の音は半分の高さいっぱいまで振れる', () => {
    expect(barHeight(1, 13, 0.6)).toBe(13)
  })

  it('平方根で持ち上げる', () => {
    expect(barHeight(0.25, 12, 0.6)).toBe(6)
  })

  it('範囲外の値は 0〜1 に丸める', () => {
    expect(barHeight(3, 13, 0.6)).toBe(13)
    expect(barHeight(-1, 13, 0.6)).toBe(0.6)
  })
})
