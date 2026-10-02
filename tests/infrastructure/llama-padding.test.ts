import { describe, expect, it } from 'vitest'
import { llamaOptionsFor } from '@infrastructure/summarization/NodeLlamaSessionFactory'

/**
 * node-llama-cpp は既定でも RAM の 25%（上限 6GB）を余白として確保する。
 * ここで確かめるのは「その既定を緩めないこと」と「保守的のときだけ締めること」。
 */
describe('llamaOptionsFor', () => {
  const totalBytes = 16 * 1_024 ** 3

  it('標準では余白をライブラリの既定に任せる', () => {
    expect(llamaOptionsFor('standard', totalBytes).ramPadding).toBeUndefined()
  })

  it('オフでも内蔵の余白は外さない', () => {
    // 「オフ」が外すのは事前チェックであって、OS を守る余白そのものではない。
    expect(llamaOptionsFor('off', totalBytes).ramPadding).toBeUndefined()
  })

  it('どの保護でも、GPU は CUDA を除いて自動で選ばせる（CUDA 版は同梱しない、ADR-048）', () => {
    // 開発中は CUDA 版のパッケージが node_modules にあるので、除かないと CUDA Toolkit のある機体で
    // 配布版（Vulkan）と違う道筋を通る。
    for (const protection of ['standard', 'off', 'conservative'] as const) {
      expect(llamaOptionsFor(protection, totalBytes).gpu).toEqual({ type: 'auto', exclude: ['cuda'] })
    }
  })

  it('保守的では既定より大きい余白を要求する', () => {
    const options = llamaOptionsFor('conservative', totalBytes)

    // ライブラリの既定は min(total * 0.25, 6GB)。
    const libraryDefault = Math.min(totalBytes * 0.25, 6 * 1_024 ** 3)
    expect(options.ramPadding).toBeGreaterThanOrEqual(libraryDefault)
  })

  it('どの総容量でもライブラリの既定を下回らない', () => {
    // 係数を後から動かしても「緩めない」ことが崩れないようにする。
    for (const gb of [8, 16, 32, 64, 128]) {
      const total = gb * 1_024 ** 3
      const options = llamaOptionsFor('conservative', total)

      expect(options.ramPadding).toBeGreaterThanOrEqual(Math.floor(Math.min(total * 0.25, 6 * 1_024 ** 3)))
    }
  })
})
