import { useCallback, useEffect, useRef, useState } from 'react'
import { LIBRARY_WIDTH, clampLibraryWidth, parseStoredWidth } from '../library/paneWidth'

/**
 * 幅の保存先。見た目の好みでしかなく、消えても既定の幅に戻るだけなので
 * 設定ファイル（ADR-035 の管理下）には載せず、レンダラーの localStorage に置く。
 */
const STORAGE_KEY = 'duoscribe.libraryWidth'

const readStored = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

const writeStored = (width: number): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    // 保存できなくても、この起動の間は動かした幅のまま使える。
  }
}

export interface LibraryWidth {
  /** いまのウィンドウに収めた幅。 */
  readonly width: number
  readonly min: number
  readonly max: number
  /** ドラッグ中の幅。保存はしない（1px ごとに書かない）。 */
  resize(width: number): void
  /** 動かし終えた幅を保存する。 */
  commit(): void
  /** 既定の幅に戻して保存する。 */
  reset(): void
}

/**
 * ライブラリの幅。利用者が選んだ幅はそのまま覚え、表示するときにだけウィンドウへ収める。
 * ウィンドウを一時的に狭めても、広げ直せば選んだ幅に戻る。
 */
export const useLibraryWidth = (): LibraryWidth => {
  const [preferred, setPreferred] = useState(() => parseStoredWidth(readStored()))
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const latest = useRef(preferred)

  useEffect(() => {
    const onResize = (): void => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const resize = useCallback(
    (width: number): void => {
      const clamped = clampLibraryWidth(width, windowWidth)
      latest.current = clamped
      setPreferred(clamped)
    },
    [windowWidth]
  )

  const commit = useCallback((): void => writeStored(latest.current), [])

  const reset = useCallback((): void => {
    latest.current = LIBRARY_WIDTH.default
    setPreferred(LIBRARY_WIDTH.default)
    writeStored(LIBRARY_WIDTH.default)
  }, [])

  return {
    width: clampLibraryWidth(preferred, windowWidth),
    min: LIBRARY_WIDTH.min,
    max: clampLibraryWidth(Number.POSITIVE_INFINITY, windowWidth),
    resize,
    commit,
    reset
  }
}
