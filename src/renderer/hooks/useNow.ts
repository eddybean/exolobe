import { useEffect, useState } from 'react'

/**
 * 表示の基準にする「今」。一定間隔で進める。
 *
 * 描画のたびに時計を読むと、同じ画面の中で基準がずれる。アプリを開いたまま
 * 日付をまたいだとき「今日」の区切りが古いままにならない程度に更新すれば足りる。
 */
export const useNow = (intervalMs = 60_000): Date => {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])

  return now
}
