import { describe, expect, it } from 'vitest'
import {
  GLOSSARY_PROMPT_LIMIT,
  formatGlossary,
  glossaryPrompt,
  parseGlossary
} from '@domain/Glossary'

describe('parseGlossary', () => {
  it('改行区切りの入力を用語の配列にする', () => {
    expect(parseGlossary('Anthropic\nClaude Code\n議事録')).toEqual([
      'Anthropic',
      'Claude Code',
      '議事録'
    ])
  })

  it('前後の空白を落とし、空行は用語にしない', () => {
    expect(parseGlossary('  Anthropic  \n\n\t\n Claude ')).toEqual(['Anthropic', 'Claude'])
  })

  it('重複は最初の 1 つだけ残す', () => {
    expect(parseGlossary('Anthropic\nClaude\nAnthropic')).toEqual(['Anthropic', 'Claude'])
  })

  it('空の入力からは用語が 1 つも取れない', () => {
    expect(parseGlossary('')).toEqual([])
    expect(parseGlossary('   \n  ')).toEqual([])
  })
})

describe('formatGlossary', () => {
  it('編集欄に戻せるよう改行区切りにする', () => {
    expect(formatGlossary(['Anthropic', 'Claude'])).toBe('Anthropic\nClaude')
  })

  it('用語が無ければ空文字', () => {
    expect(formatGlossary([])).toBe('')
  })
})

describe('glossaryPrompt', () => {
  it('用語を読点でつないで文にする', () => {
    expect(glossaryPrompt(['Anthropic', 'Claude Code'], 'ja')).toBe('Anthropic、Claude Code。')
  })

  /**
   * 英語の会議に読点と句点を見せると、whisper が日本語の句読点を英文に混ぜる。
   * 自動判定では従来どおり日本語の区切りにする（日本語の会議の結果を変えない）。
   */
  it('英語の会議ではカンマとピリオドでつなぐ', () => {
    expect(glossaryPrompt(['Anthropic', 'Claude Code'], 'en')).toBe('Anthropic, Claude Code.')
    expect(glossaryPrompt(['Anthropic', 'Claude Code'], 'auto')).toBe('Anthropic、Claude Code。')
  })

  it('用語が無ければ空文字（whisper に渡さない合図）', () => {
    expect(glossaryPrompt([], 'ja')).toBe('')
  })

  it('上限を超える分の用語は落とし、プロンプトを上限内に収める', () => {
    const terms = Array.from({ length: 60 }, (_, i) => `用語${String(i).padStart(2, '0')}`)
    const prompt = glossaryPrompt(terms, 'ja')

    expect(prompt.length).toBeLessThanOrEqual(GLOSSARY_PROMPT_LIMIT)
    // 先に書いた用語から順に残る。
    expect(prompt.startsWith('用語00、用語01、')).toBe(true)
    expect(prompt).not.toContain('用語59')
    expect(prompt.endsWith('。')).toBe(true)
  })

  it('1 語だけで上限を超えるなら空文字にして丸ごと諦める', () => {
    expect(glossaryPrompt(['あ'.repeat(GLOSSARY_PROMPT_LIMIT + 1)], 'ja')).toBe('')
  })
})
