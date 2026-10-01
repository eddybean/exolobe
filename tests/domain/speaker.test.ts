import { describe, expect, it } from 'vitest'
import { defaultRemoteGroupLabel, defaultRemoteLabel, defaultSelfLabel, isDefaultRemoteLabel } from '@domain/Speaker'

/** 話者の既定名は会議の言語で付ける。文字起こしと要約に書き込まれるため（ADR-043）。 */
describe('話者の既定名', () => {
  it('日本語の会議', () => {
    expect(defaultSelfLabel('ja')).toBe('自分')
    expect(defaultRemoteGroupLabel('ja')).toBe('参加者')
    expect(defaultRemoteLabel(0, 'ja')).toBe('参加者A')
    expect(defaultRemoteLabel(1, 'ja')).toBe('参加者B')
  })

  it('英語の会議', () => {
    expect(defaultSelfLabel('en')).toBe('Me')
    expect(defaultRemoteGroupLabel('en')).toBe('Participants')
    expect(defaultRemoteLabel(0, 'en')).toBe('Participant A')
    expect(defaultRemoteLabel(2, 'en')).toBe('Participant C')
  })
})

/**
 * 既定の採番のままなら利用者が付けた名前ではない。言語を変えて話者識別をやり直したとき、
 * 前の言語の「参加者A」を利用者の名前と取り違えると、声紋の引き当てに譲れなくなる。
 */
describe('isDefaultRemoteLabel', () => {
  it('どちらの言語の既定名も既定とみなす', () => {
    expect(isDefaultRemoteLabel('参加者A', 0)).toBe(true)
    expect(isDefaultRemoteLabel('Participant A', 0)).toBe(true)
  })

  it('番号が違えば既定とみなさない（別の話者の名前が残っている）', () => {
    expect(isDefaultRemoteLabel('参加者B', 0)).toBe(false)
  })

  it('利用者が付けた名前は既定ではない', () => {
    expect(isDefaultRemoteLabel('田中さん', 0)).toBe(false)
  })
})
