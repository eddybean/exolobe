import { describe, expect, it } from 'vitest'
import { diarizationThreads } from '@infrastructure/diarization/SherpaOnnxSessionFactory'

describe('diarizationThreads', () => {
  it('論理コアの半分までを使う', () => {
    expect(diarizationThreads(8)).toBe(4)
    expect(diarizationThreads(4)).toBe(2)
  })

  it('コアが多くても増やしすぎない', () => {
    expect(diarizationThreads(16)).toBe(4)
  })

  it('コアが 1 つでも 1 を返す', () => {
    expect(diarizationThreads(1)).toBe(1)
    expect(diarizationThreads(0)).toBe(1)
  })
})
