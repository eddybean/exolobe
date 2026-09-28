import { useRef, type ReactElement } from 'react'
import { keyboardResize } from '../library/paneWidth'
import type { LibraryWidth } from '../hooks/useLibraryWidth'
import { libraryListText } from '../i18n/libraryList'

/**
 * ライブラリと詳細の境目のつまみ。ドラッグで幅を変え、ダブルクリックで既定の幅に戻す。
 * フォーカスして左右の矢印キーでも動かせる（マウスを使わない人のため）。
 */
export const PaneResizer = ({
  pane,
  onDraggingChange
}: {
  pane: LibraryWidth
  /** ドラッグ中は画面全体で本文の選択を止めたいので、親に知らせる。 */
  onDraggingChange: (dragging: boolean) => void
}): ReactElement => {
  const drag = useRef<{ startX: number; startWidth: number } | undefined>(undefined)
  const t = libraryListText()

  const finish = (element: HTMLElement, pointerId: number): void => {
    if (!drag.current) return
    drag.current = undefined
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
    onDraggingChange(false)
    pane.commit()
  }

  return (
    <div
      className="pane-resizer"
      // hr は操作できない区切り線なので使えない。フォーカスして動かせる境目は
      // WAI-ARIA のウィンドウ分割（Window Splitter）パターンに従い separator にする。
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- 上記のとおり hr では代われない
      role="separator"
      aria-orientation="vertical"
      aria-label={t.paneAriaLabel}
      aria-valuenow={pane.width}
      aria-valuemin={pane.min}
      aria-valuemax={pane.max}
      tabIndex={0}
      title={t.paneTitle}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        // つまみから外れても追い続けるよう、ポインタを捕まえておく。
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { startX: event.clientX, startWidth: pane.width }
        onDraggingChange(true)
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        pane.resize(drag.current.startWidth + event.clientX - drag.current.startX)
      }}
      onPointerUp={(event) => finish(event.currentTarget, event.pointerId)}
      onPointerCancel={(event) => finish(event.currentTarget, event.pointerId)}
      onDoubleClick={pane.reset}
      onKeyDown={(event) => {
        const next = keyboardResize(event.key, pane.width)
        if (next === undefined) return
        event.preventDefault()
        pane.resize(next)
        pane.commit()
      }}
    />
  )
}
