import { describe, expect, it } from 'vitest'
import {
  IMPORTABLE_EXTENSIONS,
  extensionOf,
  importTitleOf,
  unsupportedImportReason
} from '@domain/AudioImport'

describe('extensionOf', () => {
  it('小文字のドット無しで返す', () => {
    expect(extensionOf('/x/y/a.MP3')).toBe('mp3')
  })

  it('複数のドットは最後だけを拡張子として見る', () => {
    expect(extensionOf('2026-09-01.定例.m4a')).toBe('m4a')
  })

  it('拡張子が無ければ空文字', () => {
    expect(extensionOf('/x/y/recording')).toBe('')
  })

  it('先頭のドットだけのファイルは拡張子扱いしない', () => {
    expect(extensionOf('/x/.hidden')).toBe('')
  })
})

describe('importTitleOf', () => {
  it('拡張子を除いたファイル名を返す', () => {
    expect(importTitleOf('/x/y/2026-09 定例.mp3')).toBe('2026-09 定例')
  })

  it('途中のドットは残す', () => {
    expect(importTitleOf('/x/a.b.mp3')).toBe('a.b')
  })

  it('拡張子が無ければファイル名そのまま', () => {
    expect(importTitleOf('/x/recording')).toBe('recording')
  })
})

describe('unsupportedImportReason', () => {
  it('afconvert が読める形式は受け入れる', () => {
    for (const extension of IMPORTABLE_EXTENSIONS) {
      expect(unsupportedImportReason(`/x/a.${extension}`)).toBeUndefined()
    }
  })

  it('大文字の拡張子も受け入れる', () => {
    expect(unsupportedImportReason('/x/A.MP3')).toBeUndefined()
  })

  it('音声として使われるが開けない形式は名指しで断る', () => {
    expect(unsupportedImportReason('/x/会議.webm')).toEqual({
      code: 'importUnreadableFormat',
      fileName: '会議.webm',
      extension: 'webm'
    })
  })

  it('音声ではない拡張子は音声として扱えないと断る', () => {
    expect(unsupportedImportReason('/x/memo.txt')).toEqual({
      code: 'importNotAudio',
      fileName: 'memo.txt'
    })
  })

  it('拡張子が無ければ判別できないことを伝える', () => {
    expect(unsupportedImportReason('/x/recording')).toEqual({
      code: 'importNoExtension',
      fileName: 'recording'
    })
  })
})
