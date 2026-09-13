import { describe, expect, it } from 'vitest'
import {
  CONTEXT_PLACEHOLDER,
  DEFAULT_CHAT_PROMPT,
  DEFAULT_CHAT_SYSTEM_PROMPT,
  QUESTION_PLACEHOLDER,
  renderChatPrompt
} from '@domain/ChatPrompt'

describe('renderChatPrompt', () => {
  it('文脈と質問を差し込み位置に入れる', () => {
    const prompt = renderChatPrompt(DEFAULT_CHAT_PROMPT, {
      context: '## [1] 2026-09-08（火） 週次定例\n（要約）\n- 見積もりは来週',
      question: '先週のTODOをまとめて'
    })

    expect(prompt).toContain('見積もりは来週')
    expect(prompt).toContain('先週のTODOをまとめて')
    expect(prompt).not.toContain(CONTEXT_PLACEHOLDER)
    expect(prompt).not.toContain(QUESTION_PLACEHOLDER)
  })

  it('差し込み位置が無いテンプレートでも文脈と質問を落とさない', () => {
    const prompt = renderChatPrompt('会議記録を読んで答えてください。', {
      context: '文脈です',
      question: '質問です'
    })

    expect(prompt).toContain('文脈です')
    expect(prompt).toContain('質問です')
  })

  it('文脈が空なら、記録が無いことをはっきり伝える', () => {
    const prompt = renderChatPrompt(DEFAULT_CHAT_PROMPT, { context: '', question: '先週のTODO' })

    expect(prompt).toContain('該当する会議の記録はありません')
    expect(prompt).toContain('先週のTODO')
  })
})

describe('既定のプロンプト', () => {
  it('システム指示は文脈だけを根拠にすることと番号での引用を求める', () => {
    expect(DEFAULT_CHAT_SYSTEM_PROMPT).toContain('推測')
    expect(DEFAULT_CHAT_SYSTEM_PROMPT).toContain('[1]')
  })

  it('既定のテンプレートは両方の差し込み位置を持つ', () => {
    expect(DEFAULT_CHAT_PROMPT).toContain(CONTEXT_PLACEHOLDER)
    expect(DEFAULT_CHAT_PROMPT).toContain(QUESTION_PLACEHOLDER)
  })
})
