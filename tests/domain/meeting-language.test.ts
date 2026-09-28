import { describe, expect, it } from 'vitest'
import { meetingLanguageOf, questionLanguageOf } from '@domain/MeetingLanguage'

/**
 * 会議の言語（要約・話者の既定名・メモの見出し）は UI の言語と別に決める（ADR-043）。
 * 英語 UI で日本語の会議を録る人もいるので、文字起こしの言語設定を正とする。
 */
describe('meetingLanguageOf', () => {
  it('文字起こしの言語が日本語・英語ならそれに従う', () => {
    expect(meetingLanguageOf('ja', 'en')).toBe('ja')
    expect(meetingLanguageOf('en', 'ja')).toBe('en')
  })

  it('自動判定のときは UI の言語に従う', () => {
    expect(meetingLanguageOf('auto', 'ja')).toBe('ja')
    expect(meetingLanguageOf('auto', 'en')).toBe('en')
  })

  it('プロンプトを用意していない言語（whisper は受け付ける）は UI の言語に従う', () => {
    expect(meetingLanguageOf('de', 'en')).toBe('en')
    expect(meetingLanguageOf('zh', 'ja')).toBe('ja')
  })
})

/** チャットは録音をまたぐので、会議の言語ではなく問いの言語で答える。 */
describe('questionLanguageOf', () => {
  it('かなか漢字を含めば日本語', () => {
    expect(questionLanguageOf('先週の TODO は？')).toBe('ja')
    expect(questionLanguageOf('Aさんの担当は')).toBe('ja')
    expect(questionLanguageOf('カタカナ')).toBe('ja')
  })

  it('含まなければ英語', () => {
    expect(questionLanguageOf('What did we decide last week?')).toBe('en')
    expect(questionLanguageOf('TODO')).toBe('en')
  })
})
