import { describe, expect, it } from 'vitest'
import {
  localeArg,
  localeFromArgv,
  localeTag,
  parseLocale,
  resolveLocale
} from '@shared/i18n/locale'

describe('resolveLocale', () => {
  it('優先言語の先頭が日本語なら日本語', () => {
    expect(resolveLocale(['ja-JP', 'en-US'])).toBe('ja')
    expect(resolveLocale(['ja'])).toBe('ja')
  })

  it('優先言語の先頭が英語なら地域を問わず英語', () => {
    expect(resolveLocale(['en-GB', 'ja-JP'])).toBe('en')
    expect(resolveLocale(['en'])).toBe('en')
  })

  it('対応していない言語は飛ばし、次に対応している言語を使う（macOS の Bundle と同じ選び方）', () => {
    expect(resolveLocale(['de-DE', 'ja-JP'])).toBe('ja')
    expect(resolveLocale(['fr-FR', 'en-US', 'ja-JP'])).toBe('en')
  })

  it('対応している言語が 1 つも無ければ英語', () => {
    expect(resolveLocale(['de-DE', 'zh-Hans-CN'])).toBe('en')
    expect(resolveLocale([])).toBe('en')
  })

  it('大文字小文字と区切りの違いを吸収する', () => {
    expect(resolveLocale(['JA_jp'])).toBe('ja')
  })

  it('似た接頭辞の別言語を取り違えない', () => {
    expect(resolveLocale(['jav', 'ja'])).toBe('ja')
    expect(resolveLocale(['jav'])).toBe('en')
  })
})

describe('localeTag', () => {
  it('Intl に渡す BCP 47 のタグを返す', () => {
    expect(localeTag('ja')).toBe('ja-JP')
    expect(localeTag('en')).toBe('en-US')
  })
})

/** main が決めた言語を renderer へ渡す引数（BrowserWindow の additionalArguments）。 */
describe('localeArg / localeFromArgv', () => {
  it('main が付けた引数から言語を読み戻す', () => {
    expect(localeFromArgv(['/path/Electron', '--type=renderer', localeArg('ja')])).toBe('ja')
    expect(localeFromArgv([localeArg('en')])).toBe('en')
  })

  it('引数が無い・知らない値なら英語', () => {
    expect(localeFromArgv(['/path/Electron'])).toBe('en')
    expect(localeFromArgv(['--omr-locale=de'])).toBe('en')
  })
})

/** main が決めた言語をワーカーへ渡す環境変数（OMR_UI_LOCALE）の読み取り。 */
describe('parseLocale', () => {
  it('対応している言語はそのまま', () => {
    expect(parseLocale('ja')).toBe('ja')
    expect(parseLocale('en')).toBe('en')
  })

  it('無い・知らない値は英語', () => {
    expect(parseLocale(undefined)).toBe('en')
    expect(parseLocale('ja-JP')).toBe('en')
  })
})
