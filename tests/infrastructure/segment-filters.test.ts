import { describe, expect, it } from 'vitest'
import { textDropReason } from '@infrastructure/transcription/segmentFilters'

describe('textDropReason', () => {
  it('非発話マーカーだけのセグメントを落とす', () => {
    expect(textDropReason('[音楽]')).toBe('non-speech')
    expect(textDropReason('♪♪')).toBe('non-speech')
  })

  it('動画の締めの定型句は、句読点や大文字の揺れを無視して落とす', () => {
    expect(textDropReason('ご視聴ありがとうございました。')).toBe('boilerplate')
    expect(textDropReason('Thanks for watching!')).toBe('boilerplate')
  })

  it('定型句を含むだけの本物の発言は残す', () => {
    expect(textDropReason('資料の共有ありがとうございました')).toBeUndefined()
  })

  it('エンジン固有の定型句を足せる', () => {
    expect(textDropReason('はい。', ['はい'])).toBe('boilerplate')
    expect(textDropReason('はい。')).toBeUndefined()
  })
})
