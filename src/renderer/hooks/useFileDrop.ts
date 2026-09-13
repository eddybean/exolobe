import { useEffect, useRef, useState } from 'react'
import { isExternalFileDrag, nextDragDepth } from '../library/fileDrop'

/**
 * ウィンドウへ落とされたファイルを受け取る。
 *
 * window に張るのが要点。ドロップ先を狭い領域に限ると利用者が狙いを外すうえ、
 * 領域外でドロップされると Chromium がそのファイルへ遷移して画面が壊れる
 * （dragover の既定動作を止めるのは画面全体で必要）。
 *
 * ツリー内の録音・フォルダの移動は独自 MIME で始まるので手を出さない。
 */
export const useFileDrop = (params: {
  enabled: boolean
  onDrop: (filePaths: readonly string[]) => void
}): { active: boolean } => {
  const [active, setActive] = useState(false)
  const depth = useRef(0)
  // ハンドラを張り替えずに最新の onDrop を呼ぶ。
  const onDrop = useRef(params.onDrop)

  useEffect(() => {
    onDrop.current = params.onDrop
  }, [params.onDrop])

  useEffect(() => {
    const isTarget = (event: DragEvent): boolean =>
      event.dataTransfer !== null && isExternalFileDrag([...event.dataTransfer.types])

    const reset = (): void => {
      depth.current = 0
      setActive(false)
    }

    const onDragEnter = (event: DragEvent): void => {
      if (!isTarget(event)) return
      event.preventDefault()
      depth.current = nextDragDepth(depth.current, 'enter')
      setActive(true)
    }

    const onDragOver = (event: DragEvent): void => {
      if (!isTarget(event)) return
      // 止めないとファイルを開こうとして画面が遷移する。
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    const onDragLeave = (event: DragEvent): void => {
      if (!isTarget(event)) return
      depth.current = nextDragDepth(depth.current, 'leave')
      if (depth.current === 0) setActive(false)
    }

    const onDropped = (event: DragEvent): void => {
      if (!isTarget(event)) return
      event.preventDefault()
      reset()

      const paths = [...(event.dataTransfer?.files ?? [])]
        .map((file) => window.recorder.pathForFile(file))
        .filter((path) => path.length > 0)

      if (paths.length > 0) onDrop.current(paths)
    }

    // 無効な画面でも既定動作だけは止める。ファイルへ遷移すると戻る手段が無い。
    const blockNavigation = (event: DragEvent): void => {
      if (isTarget(event)) event.preventDefault()
    }

    if (!params.enabled) {
      window.addEventListener('dragover', blockNavigation)
      window.addEventListener('drop', blockNavigation)
      return () => {
        window.removeEventListener('dragover', blockNavigation)
        window.removeEventListener('drop', blockNavigation)
      }
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDropped)

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDropped)
      reset()
    }
  }, [params.enabled])

  return { active }
}
