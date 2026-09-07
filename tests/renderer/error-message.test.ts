import { describe, expect, it } from 'vitest'
import { messageOf } from '@renderer/errorMessage'

describe('messageOf', () => {
  it('IPC 越しの前置きを外して本文だけにする', () => {
    const error = new Error(
      "Error invoking remote method 'models:delete': Error: 録音中はモデルを削除できません。"
    )

    expect(messageOf(error)).toBe('録音中はモデルを削除できません。')
  })

  it('独自のエラー名が付いていても外す', () => {
    const error = new Error(
      "Error invoking remote method 'models:delete': ModelInUseError: 処理中の録音があります。"
    )

    expect(messageOf(error)).toBe('処理中の録音があります。')
  })

  it('前置きが無いメッセージはそのまま返す', () => {
    expect(messageOf(new Error('マイクを取得できませんでした。'))).toBe(
      'マイクを取得できませんでした。'
    )
  })

  it('Error 以外は文字列にして返す', () => {
    expect(messageOf('落ちました')).toBe('落ちました')
    expect(messageOf(undefined)).toBe('undefined')
  })
})
