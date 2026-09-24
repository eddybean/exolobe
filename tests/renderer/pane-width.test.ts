import { describe, expect, it } from 'vitest'
import {
  LIBRARY_WIDTH,
  clampLibraryWidth,
  keyboardResize,
  parseStoredWidth
} from '@renderer/library/paneWidth'

/**
 * ライブラリと詳細の境目は、ドラッグで自由に動かせる。ただし詳細が潰れて
 * 文字起こしと要約が読めなくなる幅や、ライブラリの行が読めない幅までは寄せさせない。
 */
describe('clampLibraryWidth', () => {
  it('範囲内ならそのまま', () => {
    expect(clampLibraryWidth(400, 1400)).toBe(400)
  })

  it('狭すぎればライブラリの最小幅で止める', () => {
    expect(clampLibraryWidth(100, 1400)).toBe(LIBRARY_WIDTH.min)
  })

  it('広すぎれば詳細の最小幅を残して止める', () => {
    expect(clampLibraryWidth(1200, 1400)).toBe(1400 - LIBRARY_WIDTH.detailMin)
  })

  it('ウィンドウが狭くて両方を満たせないときは、ライブラリの最小幅を優先する', () => {
    expect(clampLibraryWidth(500, 600)).toBe(LIBRARY_WIDTH.min)
  })

  it('端数は丸める（保存した値で 1px ずつずれていかないように）', () => {
    expect(clampLibraryWidth(333.6, 1400)).toBe(334)
  })
})

describe('parseStoredWidth', () => {
  it('保存された数値を読む', () => {
    expect(parseStoredWidth('412')).toBe(412)
  })

  it('無い・読めない値は既定の幅にする', () => {
    expect(parseStoredWidth(null)).toBe(LIBRARY_WIDTH.default)
    expect(parseStoredWidth('wide')).toBe(LIBRARY_WIDTH.default)
    expect(parseStoredWidth('-5')).toBe(LIBRARY_WIDTH.default)
  })
})

/** マウスを使わない人も幅を変えられるよう、境目にフォーカスして矢印キーで動かす。 */
describe('keyboardResize', () => {
  it('左右の矢印で少しずつ動かす', () => {
    expect(keyboardResize('ArrowRight', 320)).toBe(320 + LIBRARY_WIDTH.step)
    expect(keyboardResize('ArrowLeft', 320)).toBe(320 - LIBRARY_WIDTH.step)
  })

  it('それ以外のキーでは動かさない', () => {
    expect(keyboardResize('Enter', 320)).toBeUndefined()
  })
})
