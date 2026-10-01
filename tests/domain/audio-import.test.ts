import { describe, expect, it } from 'vitest'
import {
  AFCONVERT_IMPORT_FORMATS,
  MEDIA_FOUNDATION_IMPORT_FORMATS,
  SUGGESTED_IMPORT_FORMATS,
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

  it('Windows のパス（\\ 区切り）からもファイル名だけを取る', () => {
    expect(importTitleOf('C:\\Users\\me\\会議\\2026-09 定例.m4a')).toBe('2026-09 定例')
  })
})

describe('unsupportedImportReason', () => {
  const formats = AFCONVERT_IMPORT_FORMATS

  it('afconvert が読める形式は受け入れる', () => {
    for (const extension of AFCONVERT_IMPORT_FORMATS.importable) {
      expect(unsupportedImportReason(`/x/a.${extension}`, formats)).toBeUndefined()
    }
  })

  it('大文字の拡張子も受け入れる', () => {
    expect(unsupportedImportReason('/x/A.MP3', formats)).toBeUndefined()
  })

  it('音声として使われるが開けない形式は名指しで断る', () => {
    expect(unsupportedImportReason('/x/会議.webm', formats)).toEqual({
      code: 'importUnreadableFormat',
      fileName: '会議.webm',
      extension: 'webm'
    })
  })

  it('音声ではない拡張子は音声として扱えないと断る', () => {
    expect(unsupportedImportReason('/x/memo.txt', formats)).toEqual({
      code: 'importNotAudio',
      fileName: 'memo.txt'
    })
  })

  it('拡張子が無ければ判別できないことを伝える', () => {
    expect(unsupportedImportReason('/x/recording', formats)).toEqual({
      code: 'importNoExtension',
      fileName: 'recording'
    })
  })

  it('読める形式は変換器ごとに違う（Media Foundation は webm を読み、ogg を読めない）', () => {
    const windows = MEDIA_FOUNDATION_IMPORT_FORMATS

    expect(unsupportedImportReason('C:\\x\\会議.webm', windows)).toBeUndefined()
    expect(unsupportedImportReason('C:\\x\\会議.ogg', windows)).toEqual({
      code: 'importUnreadableFormat',
      fileName: '会議.ogg',
      extension: 'ogg'
    })
  })

  it('どの変換器でも、同じ拡張子を「読める」と「読めない」の両方に入れない', () => {
    for (const { importable, unreadable } of [AFCONVERT_IMPORT_FORMATS, MEDIA_FOUNDATION_IMPORT_FORMATS]) {
      expect(importable.filter((extension) => unreadable.includes(extension))).toEqual([])
    }
  })
})

describe('取り込めないときに案内する形式', () => {
  it('どの OS の変換器でも読める形式だけを挙げる（読めない形式への変換を勧めない）', () => {
    for (const formats of [AFCONVERT_IMPORT_FORMATS, MEDIA_FOUNDATION_IMPORT_FORMATS]) {
      expect(SUGGESTED_IMPORT_FORMATS.filter((extension) => !formats.importable.includes(extension))).toEqual([])
    }
  })
})
