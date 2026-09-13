import { describe, expect, it } from 'vitest'
import { dot, normalize } from '@domain/vector'

describe('normalize / dot', () => {
  it('長さ 1 に揃え、内積がコサイン類似度になる', () => {
    const a = normalize([3, 4])
    const b = normalize([6, 8])

    expect(Array.from(a)).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)])
    expect(dot(a, b)).toBeCloseTo(1)
  })

  it('ゼロベクトルはゼロのまま返す（NaN を索引に入れない）', () => {
    expect(Array.from(normalize([0, 0]))).toEqual([0, 0])
  })
})
