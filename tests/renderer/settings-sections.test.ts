import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SETTINGS_SECTIONS, initialSettingsSection } from '@renderer/settingsSections'

/**
 * 設定画面は左のナビで項目を選び、右にその項目だけを出す。1 本の縦長のページでは
 * 保存先のような基本の項目と、しきい値やプロンプトのような細かい項目が同列に並び、
 * 目当ての設定まで遠かった。
 */
describe('SETTINGS_SECTIONS', () => {
  it('よく触る順に並べ、ライセンスは最後に置く', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      'recording',
      'transcription',
      'diarization',
      'summarization',
      'search',
      'models',
      'storage',
      'about'
    ])
  })

  it('ナビの表記は重ならない', () => {
    const labels = SETTINGS_SECTIONS.map((section) => section.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('initialSettingsSection', () => {
  it('前に開いていた項目があれば、そこから開く', () => {
    expect(initialSettingsSection({ storageDir: '/data', previous: 'summarization' })).toBe(
      'summarization'
    )
  })

  it('保存先が未設定なら、ほかより先に保存先を開く（決めないと録音できない）', () => {
    expect(initialSettingsSection({ storageDir: null, previous: 'summarization' })).toBe('storage')
  })

  it('初めて開くなら先頭の項目', () => {
    expect(initialSettingsSection({ storageDir: '/data', previous: undefined })).toBe('recording')
  })
})

const css = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8')

/**
 * セレクタがそれだけで書かれたルールを取り出す。前方一致で探すと、`.settings` が
 * 先に出てくる `.settings__error` のルールに当たってしまう。
 */
const ruleFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  if (!match?.[2]) throw new Error(`styles.css に ${selector} のルールが見つかりません。`)
  return match[2]
}

/**
 * ナビと中身は別々にスクロールする。ページごとスクロールすると、長い項目
 * （要約のプロンプト、声紋帳）を下まで見たときにナビが画面外へ消える。
 */
describe('設定画面の構成', () => {
  it('ナビと中身の 2 カラムである', () => {
    expect(ruleFor('.settings')).toMatch(/grid-template-columns:\s*\d+px\s+minmax\(0,\s*1fr\)/)
  })

  it('中身だけがスクロールし、ナビは残る', () => {
    expect(ruleFor('.settings__content')).toMatch(/overflow-y:\s*auto/)
    expect(ruleFor('.settings')).not.toMatch(/overflow-y:\s*auto/)
  })
})
