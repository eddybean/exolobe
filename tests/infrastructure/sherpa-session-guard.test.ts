import { describe, expect, it } from 'vitest'
import { DiarizationError } from '@infrastructure/diarization/SherpaOnnxDiarizer'
import { processWithHeapGuard } from '@infrastructure/diarization/SherpaOnnxSessionFactory'

/** Emscripten の Module のうち、ヒープの空き確認に使う部分だけの代役。 */
const fakeHeap = (available: number) => {
  const allocated: number[] = []
  return {
    allocated,
    freed: [] as number[],
    _malloc(bytes: number): number {
      if (bytes > available) return 0
      allocated.push(bytes)
      return 1024
    },
    _free(pointer: number): void {
      this.freed.push(pointer)
    }
  }
}

const samples = new Float32Array([0.1, 0.2, 0.3])

describe('processWithHeapGuard', () => {
  it('空きがあれば推論を呼び、確認に使った領域は解放する', () => {
    const heap = fakeHeap(1_000)
    const diarization = {
      Module: heap,
      process: () => [{ start: 0, end: 1, speaker: 0 }]
    }

    expect(processWithHeapGuard(diarization, samples)).toEqual([{ start: 0, end: 1, speaker: 0 }])
    expect(heap.allocated).toEqual([samples.length * 4])
    expect(heap.freed).toEqual([1024])
  })

  it('音声ぶんのヒープを確保できないなら推論を呼ばずに理由を伝える', () => {
    const heap = fakeHeap(4)
    let called = false
    const diarization = {
      Module: heap,
      process: () => {
        called = true
        return []
      }
    }

    expect(() => processWithHeapGuard(diarization, samples)).toThrow(DiarizationError)
    expect(() => processWithHeapGuard(diarization, samples)).toThrow(/メモリ/)
    expect(called).toBe(false)
  })

  it('wasm がヒープ外アクセスで落ちたらメモリ不足として伝える', () => {
    const diarization = {
      Module: fakeHeap(1_000),
      process: () => {
        throw new WebAssembly.RuntimeError('memory access out of bounds')
      }
    }

    expect(() => processWithHeapGuard(diarization, samples)).toThrow(/メモリ/)
  })

  it('C++ 例外が数値のまま飛んできても数値だけを見せない', () => {
    const diarization = {
      Module: fakeHeap(1_000),
      process: () => {
        throw 260_476_136
      }
    }

    expect(() => processWithHeapGuard(diarization, samples)).toThrow(/メモリ/)
    expect(() => processWithHeapGuard(diarization, samples)).not.toThrow(/^260476136$/)
  })

  it('Module を持たない版でも推論はそのまま行う', () => {
    const diarization = { process: () => [{ start: 0, end: 2, speaker: 1 }] }

    expect(processWithHeapGuard(diarization, samples)).toEqual([{ start: 0, end: 2, speaker: 1 }])
  })
})
