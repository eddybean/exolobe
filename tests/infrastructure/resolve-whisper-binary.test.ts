import { describe, expect, it } from 'vitest'
import { resolveWhisperBinary } from '@infrastructure/transcription/resolveWhisperBinary'

describe('resolveWhisperBinary', () => {
  it('既定値のままなら同梱バイナリを使う', () => {
    expect(
      resolveWhisperBinary({ configured: 'whisper-cli', bundled: '/App/Resources/bin/whisper-cli' })
    ).toBe('/App/Resources/bin/whisper-cli')
  })

  it('同梱が無ければ PATH 上の whisper-cli を使う（開発時）', () => {
    expect(resolveWhisperBinary({ configured: 'whisper-cli' })).toBe('whisper-cli')
  })

  it('利用者が指定したパスは同梱より優先する', () => {
    expect(
      resolveWhisperBinary({
        configured: '/opt/homebrew/bin/whisper-cli',
        bundled: '/App/Resources/bin/whisper-cli'
      })
    ).toBe('/opt/homebrew/bin/whisper-cli')
  })

  it('空文字なら既定値として扱う', () => {
    expect(resolveWhisperBinary({ configured: '  ', bundled: '/bundled' })).toBe('/bundled')
    expect(resolveWhisperBinary({ configured: '' })).toBe('whisper-cli')
  })
})
