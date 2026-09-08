import { describe, expect, it } from 'vitest'
import { isCommitEnter } from '@renderer/keyboard'

/**
 * 日本語入力では変換候補を確定するために Enter を押す。その Enter を入力の確定と
 * 取り違えると、変換の途中で編集が終わってしまう。IME の合成中かどうかで見分ける。
 */
describe('isCommitEnter', () => {
  it('通常の Enter は確定とみなす', () => {
    expect(isCommitEnter({ key: 'Enter', keyCode: 13, nativeEvent: { isComposing: false } })).toBe(
      true
    )
  })

  it('IME の変換確定の Enter は無視する', () => {
    expect(isCommitEnter({ key: 'Enter', keyCode: 229, nativeEvent: { isComposing: true } })).toBe(
      false
    )
  })

  it('isComposing を持たない環境でも keyCode 229 なら無視する', () => {
    expect(isCommitEnter({ key: 'Enter', keyCode: 229, nativeEvent: { isComposing: false } })).toBe(
      false
    )
  })

  it('Enter 以外は確定ではない', () => {
    expect(isCommitEnter({ key: 'a', keyCode: 65, nativeEvent: { isComposing: false } })).toBe(false)
    expect(isCommitEnter({ key: 'Escape', keyCode: 27, nativeEvent: { isComposing: false } })).toBe(
      false
    )
  })
})
