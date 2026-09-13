import { describe, expect, it } from 'vitest'
import { sherpaThreads } from '@infrastructure/diarization/sherpaModule'

describe('sherpaThreads', () => {
  it('論理コアの半分までを使う', () => {
    expect(sherpaThreads(8)).toBe(4)
    expect(sherpaThreads(4)).toBe(2)
  })

  it('コアが多くても増やしすぎない', () => {
    expect(sherpaThreads(16)).toBe(4)
  })

  it('コアが 1 つでも 1 を返す', () => {
    expect(sherpaThreads(1)).toBe(1)
    expect(sherpaThreads(0)).toBe(1)
  })
})
