import { useEffect, useState } from 'react'
import type { UpdateStatusDto } from '@shared/ipc'

/**
 * 新しい版の確認の結果。main が裏で確かめるたびに届くので、ナビの知らせと設定画面が同じものを見る。
 */
export const useUpdateStatus = (): [UpdateStatusDto | undefined, (status: UpdateStatusDto) => void] => {
  const [status, setStatus] = useState<UpdateStatusDto>()

  useEffect(() => {
    let alive = true
    window.recorder
      .getUpdateStatus()
      .then((initial) => {
        // 購読で先に新しい結果が届いていたら、古い初期値で上書きしない。
        if (alive) setStatus((current) => current ?? initial)
      })
      .catch(() => undefined)
    const unsubscribe = window.recorder.onUpdateStatusChanged(setStatus)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return [status, setStatus]
}
