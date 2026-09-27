import { describe, expect, it } from 'vitest'
import { speakerNameSuggestions } from '@renderer/speakerSuggestions'

/**
 * 話者名を書き換えるときの候補（ADR-040）。この会議の予定にいた参加者を先に、
 * 声紋帳に名前がある人（過去に名付けた人）を後に並べる。
 */
describe('speakerNameSuggestions', () => {
  it('予定の参加者を先に、声紋帳の名前を後に並べる', () => {
    expect(
      speakerNameSuggestions({
        participants: ['山田 太郎', '佐藤 花子'],
        voiceprintNames: ['鈴木 一郎'],
        currentLabel: '参加者A'
      })
    ).toEqual(['山田 太郎', '佐藤 花子', '鈴木 一郎'])
  })

  it('両方にいる人は一度だけ出す', () => {
    expect(
      speakerNameSuggestions({
        participants: ['山田 太郎'],
        voiceprintNames: ['山田 太郎', '鈴木 一郎'],
        currentLabel: '参加者A'
      })
    ).toEqual(['山田 太郎', '鈴木 一郎'])
  })

  it('いま付いている名前は候補にしない', () => {
    expect(
      speakerNameSuggestions({
        participants: ['山田 太郎', '佐藤 花子'],
        voiceprintNames: [],
        currentLabel: '山田 太郎'
      })
    ).toEqual(['佐藤 花子'])
  })

  it('予定が無い録音でも、声紋帳の名前は出す', () => {
    expect(
      speakerNameSuggestions({ participants: undefined, voiceprintNames: ['鈴木 一郎'], currentLabel: '参加者A' })
    ).toEqual(['鈴木 一郎'])
  })
})
