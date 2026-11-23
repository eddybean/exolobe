import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * メッセージをフッターに並べると、長い文で高さが伸び、重なると横に押し合って崩れた。
 * トーストはフッターの外に浮かせて縦に積み、文は折り返す。
 * レイアウトの結果は単体テストでは測れないため、宣言そのものを固定する。
 */
const css = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8')

const ruleFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  if (!match?.[2]) throw new Error(`styles.css に ${selector} のルールが見つかりません。`)
  return match[2]
}

describe('トーストの配置', () => {
  it('フッターの流れから外し、フッターのすぐ上の右端に浮かせる', () => {
    const rule = ruleFor('.toasts')

    // フッターの高さに依らず真上に来るよう、フッターを基準にする。
    expect(ruleFor('.transport')).toMatch(/position:\s*relative/)
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/right:/)
    expect(rule).toMatch(/bottom:\s*calc\(100%/)
  })

  it('縦に積む', () => {
    const rule = ruleFor('.toasts')

    expect(rule).toMatch(/display:\s*flex/)
    expect(rule).toMatch(/flex-direction:\s*column/)
  })

  it('幅を決めて、長い文は折り返す', () => {
    const rule = ruleFor('.toast')

    expect(rule).toMatch(/width:/)
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('メッセージの帯はフッターに残っていない', () => {
    for (const selector of [
      '.transport__error',
      '.transport__warning',
      '.transport__silence',
      '.transport__start-alert'
    ]) {
      expect(css).not.toContain(selector)
    }
  })
})
