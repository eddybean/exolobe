import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '@renderer/i18n/locale'
import { formatDateTime, statusLabel } from '@renderer/format'

afterEach(() => {
  setLocale('ja')
})

describe('statusLabel', () => {
  it('日本語では既存の文言を返す', () => {
    expect(statusLabel('recording')).toBe('録音中')
    expect(statusLabel('processing')).toBe('処理中')
    expect(statusLabel('ready')).toBe('完了')
    expect(statusLabel('failed')).toBe('一部失敗')
  })

  it('英語では英語の状態名を返す', () => {
    setLocale('en')
    expect(statusLabel('recording')).toBe('Recording')
    expect(statusLabel('processing')).toBe('Processing')
    expect(statusLabel('ready')).toBe('Done')
    expect(statusLabel('failed')).toBe('Partial failure')
  })

  it('知らない状態（新しい版の保存データ）は状態名をそのまま返す', () => {
    expect(statusLabel('unknown-status')).toBe('unknown-status')
  })
})

describe('formatDateTime', () => {
  it('英語ロケールでは英語の月名で書式化する', () => {
    setLocale('en')
    // 同じ年なら年は省く（既存のふるまいを保つ）。
    const iso = new Date().getFullYear() + '-03-01T09:05:00+09:00'
    expect(formatDateTime(iso)).toMatch(/Mar/)
  })
})
