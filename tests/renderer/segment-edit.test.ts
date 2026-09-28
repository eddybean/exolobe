import { describe, expect, it } from 'vitest'
import { shouldStartEditOnTextClick, splitTrailingChar } from '../../src/renderer/segmentEdit'

describe('splitTrailingChar', () => {
  it('末尾の 1 文字を切り出す（ペンをこの文字と一緒に折り返させる）', () => {
    expect(splitTrailingChar('今日の議題です。')).toEqual(['今日の議題です', '。'])
  })

  it('サロゲートペアを割らない', () => {
    expect(splitTrailingChar('了解🙆')).toEqual(['了解', '🙆'])
  })

  it('空文字はそのまま', () => {
    expect(splitTrailingChar('')).toEqual(['', ''])
  })
})

describe('shouldStartEditOnTextClick', () => {
  it('ただ押しただけなら編集に入る', () => {
    expect(shouldStartEditOnTextClick('')).toBe(true)
  })

  it('範囲を選んだ直後の click では編集に入らない（コピーのための選択を奪わない）', () => {
    expect(shouldStartEditOnTextClick('議題')).toBe(false)
  })
})
