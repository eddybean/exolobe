/**
 * ライブラリ（左）と詳細（右）の境目の位置。
 *
 * 境目はドラッグで自由に動かせるが、ライブラリの行が読めない幅や、詳細の
 * 文字起こしと要約が潰れる幅までは寄せさせない。
 */
export const LIBRARY_WIDTH = {
  default: 320,
  /** これより狭いと、フォルダのボタンと録音のタイトルがほとんど省略される。 */
  min: 240,
  /** 詳細に最低限残す幅。文字起こしと要約を左右に並べて読める幅。 */
  detailMin: 520,
  /** 矢印キー 1 回で動かす量。 */
  step: 16
} as const

/**
 * 幅をウィンドウに収まる範囲へ丸める。ウィンドウが狭くて両方を満たせないときは
 * ライブラリの最小幅を優先する（詳細はウィンドウを広げれば戻るが、ライブラリが
 * 消えると録音を選べなくなる）。
 */
export const clampLibraryWidth = (width: number, windowWidth: number): number => {
  const max = Math.max(LIBRARY_WIDTH.min, windowWidth - LIBRARY_WIDTH.detailMin)
  return Math.round(Math.min(Math.max(width, LIBRARY_WIDTH.min), max))
}

/** 保存しておいた幅を読む。無い・壊れた値は既定の幅にする。 */
export const parseStoredWidth = (raw: string | null): number => {
  const width = Number(raw)
  return raw !== null && Number.isFinite(width) && width > 0 ? width : LIBRARY_WIDTH.default
}

/** 境目にフォーカスしているときのキー操作。動かさないキーなら undefined。 */
export const keyboardResize = (key: string, width: number): number | undefined => {
  if (key === 'ArrowLeft') return width - LIBRARY_WIDTH.step
  if (key === 'ArrowRight') return width + LIBRARY_WIDTH.step
  return undefined
}
