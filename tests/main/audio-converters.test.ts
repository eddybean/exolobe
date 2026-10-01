import { describe, expect, it } from 'vitest'
import { AFCONVERT_IMPORT_FORMATS, MEDIA_FOUNDATION_IMPORT_FORMATS } from '@domain/AudioImport'
import { AfconvertDecoder } from '@infrastructure/audio/AfconvertDecoder'
import { AfconvertEncoder } from '@infrastructure/audio/AfconvertEncoder'
import { MediaFoundationDecoder } from '@infrastructure/audio/MediaFoundationDecoder'
import { MediaFoundationEncoder } from '@infrastructure/audio/MediaFoundationEncoder'
import { audioConvertersFor } from '../../src/main/audioConverters'

describe('audioConvertersFor', () => {
  it('macOS は afconvert と、afconvert が読める形式の一覧を組にする', () => {
    const converters = audioConvertersFor('darwin', undefined)

    expect(converters.encoder).toBeInstanceOf(AfconvertEncoder)
    expect(converters.decoder).toBeInstanceOf(AfconvertDecoder)
    expect(converters.importFormats).toBe(AFCONVERT_IMPORT_FORMATS)
  })

  it('Windows は Media Foundation（audioconv.exe）と、Media Foundation が読める形式の一覧を組にする', () => {
    const converters = audioConvertersFor('win32', 'C:/app/resources/bin/audioconv.exe')

    expect(converters.encoder).toBeInstanceOf(MediaFoundationEncoder)
    expect(converters.decoder).toBeInstanceOf(MediaFoundationDecoder)
    expect(converters.importFormats).toBe(MEDIA_FOUNDATION_IMPORT_FORMATS)
  })
})
