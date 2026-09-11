import { describe, expect, it } from 'vitest'
import {
  estimateSummarizationBytes,
  estimateEmbeddingBytes,
  estimateTranscriptionBytes,
  headroomBytes,
  insufficientMemory
} from '@domain/MemoryGuard'

const GB = 1_024 ** 3
/** 実測に使った Gemma 4 E4B QAT q4_0 のファイルサイズ。 */
const GEMMA_BYTES = 5_154_941_280
const WHISPER_BYTES = 574_041_195
const BGE_M3_BYTES = 634_553_760

describe('headroomBytes', () => {
  it('保守的なほど OS に大きく空けておく', () => {
    const total = 16 * GB

    expect(headroomBytes('off', total)).toBe(0)
    expect(headroomBytes('standard', total)).toBeLessThan(headroomBytes('conservative', total))
  })

  it('小容量の機体でも下限を確保する', () => {
    // 総量比だけで決めると 8GB 機で余白が小さくなりすぎる。
    expect(headroomBytes('standard', 8 * GB)).toBeGreaterThanOrEqual(1 * GB)
    expect(headroomBytes('conservative', 8 * GB)).toBeGreaterThanOrEqual(3 * GB)
  })

  it('大容量の機体では総量に比例して増える', () => {
    expect(headroomBytes('standard', 64 * GB)).toBeGreaterThan(headroomBytes('standard', 16 * GB))
  })
})

describe('estimateSummarizationBytes', () => {
  /**
   * 期待値は実機の node-llama-cpp（GgufInsights）で測った値に基づく。
   *   モデル      : 5,139,118,400 (VRAM) + 550,502,400 (RAM) = 約 5.69GB
   *   32K コンテキスト: 1,137,725,440 (VRAM) + 135,054,848 (RAM) = 約 1.27GB
   * 見積もりは実測を下回ってはならない（下回るとガードが素通りする）。
   */
  const MEASURED_MODEL = 5_139_118_400 + 550_502_400
  const MEASURED_CTX_32K = 1_137_725_440 + 135_054_848

  it('実測値を下回らない', () => {
    const estimate = estimateSummarizationBytes({
      modelFileBytes: GEMMA_BYTES,
      contextSize: 32_768
    })

    expect(estimate).toBeGreaterThanOrEqual(MEASURED_MODEL + MEASURED_CTX_32K)
  })

  it('実測値からかけ離れて大きくはしない', () => {
    const estimate = estimateSummarizationBytes({
      modelFileBytes: GEMMA_BYTES,
      contextSize: 32_768
    })

    // 過大な見積もりは、動くはずの環境で要約を拒む。1.3 倍を上限とする。
    expect(estimate).toBeLessThan((MEASURED_MODEL + MEASURED_CTX_32K) * 1.3)
  })

  it('コンテキスト長を伸ばすと増える', () => {
    const small = estimateSummarizationBytes({ modelFileBytes: GEMMA_BYTES, contextSize: 8_192 })
    const large = estimateSummarizationBytes({ modelFileBytes: GEMMA_BYTES, contextSize: 65_536 })

    expect(large).toBeGreaterThan(small)
  })

  it('モデルが大きいほど増える', () => {
    const base = { contextSize: 32_768 }
    expect(estimateSummarizationBytes({ ...base, modelFileBytes: 8 * GB })).toBeGreaterThan(
      estimateSummarizationBytes({ ...base, modelFileBytes: 4 * GB })
    )
  })
})

describe('estimateTranscriptionBytes', () => {
  it('モデルより大きく、要約よりはるかに小さい', () => {
    const estimate = estimateTranscriptionBytes({ modelFileBytes: WHISPER_BYTES })

    expect(estimate).toBeGreaterThan(WHISPER_BYTES)
    expect(estimate).toBeLessThan(
      estimateSummarizationBytes({ modelFileBytes: GEMMA_BYTES, contextSize: 32_768 })
    )
  })
})

describe('estimateEmbeddingBytes', () => {
  it('実測したピーク（bge-m3 Q8_0 で約 1.88GB）を下回らない', () => {
    expect(estimateEmbeddingBytes({ modelFileBytes: BGE_M3_BYTES })).toBeGreaterThanOrEqual(
      1_880_000_000
    )
  })

  it('要約よりはるかに小さい', () => {
    expect(estimateEmbeddingBytes({ modelFileBytes: BGE_M3_BYTES })).toBeLessThan(
      estimateSummarizationBytes({ modelFileBytes: GEMMA_BYTES, contextSize: 32_768 }) / 2
    )
  })
})

describe('insufficientMemory', () => {
  const total = 16 * GB
  const demand = { bytes: 7 * GB, label: '要約' }

  it('余白を含めて足りていれば通す', () => {
    const snapshot = { totalBytes: total, availableBytes: 12 * GB }

    expect(insufficientMemory({ snapshot, demand, protection: 'standard' })).toBeUndefined()
  })

  it('足りなければ理由を日本語で返す', () => {
    const snapshot = { totalBytes: total, availableBytes: 3 * GB }
    const message = insufficientMemory({ snapshot, demand, protection: 'standard' })

    expect(message).toBeDefined()
    expect(message).toContain('要約')
    // 利用者が次に何をすればよいか分かること。
    expect(message).toContain('再実行')
  })

  it('オフならどれだけ足りなくても通す', () => {
    const snapshot = { totalBytes: total, availableBytes: 0 }

    expect(insufficientMemory({ snapshot, demand, protection: 'off' })).toBeUndefined()
  })

  it('保守的にすると標準では通る状況でも止める', () => {
    // 余白の差だけで結果が変わる領域を選ぶ（標準 7+1.6GB、保守的 7+3.2GB）。
    const snapshot = { totalBytes: total, availableBytes: 9 * GB }

    expect(insufficientMemory({ snapshot, demand, protection: 'standard' })).toBeUndefined()
    expect(insufficientMemory({ snapshot, demand, protection: 'conservative' })).toBeDefined()
  })

  it('空き容量が読めなかった場合は止めない', () => {
    // 測定に失敗したことを理由に処理を拒むと、ガードが機能低下そのものになる。
    const snapshot = { totalBytes: total, availableBytes: Number.NaN }

    expect(insufficientMemory({ snapshot, demand, protection: 'conservative' })).toBeUndefined()
  })
})
