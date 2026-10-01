import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * OS で変わる見た目の契約（ADR-048）。描画の結果は単体テストで測れないので、宣言そのものを固定する。
 */
const css = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8')

const exactRuleFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  if (!match?.[2]) throw new Error(`styles.css に ${selector} だけのルールが見つかりません。`)
  return match[2]
}

describe('OS ごとの見た目', () => {
  it('Windows は標準のウィンドウ枠なので、信号機ボタンの余白もドラッグ領域も持たない', () => {
    const rule = exactRuleFor(":root[data-platform='windows'] .nav")

    expect(rule).toMatch(/padding-left:\s*16px/)
    expect(rule).toMatch(/-webkit-app-region:\s*no-drag/)
  })

  it('本文の書体は Windows の日本語 UI 書体にも落ちる', () => {
    expect(exactRuleFor('body')).toMatch(/'Yu Gothic UI'/)
  })

  it('等幅の書体は Windows の Consolas にも落ちる', () => {
    const monospace = css.match(/font-family:[^;]*monospace;/g) ?? []

    expect(monospace.length).toBeGreaterThan(0)
    expect(monospace.every((declaration) => declaration.includes('Consolas'))).toBe(true)
  })
})
