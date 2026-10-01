import { useEffect, useRef, type ReactElement } from 'react'
import { LEVEL_HISTORY_CAPACITY, LEVEL_SAMPLE_INTERVAL_MS, barHeight, type LevelSample } from '../session/levelHistory'

const WIDTH = 200
const HEIGHT = 28
const COLUMN = WIDTH / LEVEL_HISTORY_CAPACITY
const HALF = HEIGHT / 2 - 1

const cssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

const paint = (ctx: CanvasRenderingContext2D, history: readonly LevelSample[]): void => {
  const mid = HEIGHT / 2
  ctx.clearRect(0, 0, WIDTH, HEIGHT)

  // 上が相手（デスクトップ音声）、下が自分（マイク）。ライブ画面の話者の色と揃える。
  const remote = cssVar('--tone-1')
  const self = cssVar('--tone-0')

  history.forEach((sample, index) => {
    const x = WIDTH - (history.length - index) * COLUMN
    // 古い側ほど薄くして、流れている向きが分かるようにする。
    ctx.globalAlpha = 0.35 + 0.65 * (x / WIDTH)

    const up = barHeight(sample.system, HALF, 0.6)
    ctx.fillStyle = remote
    ctx.beginPath()
    ctx.roundRect(x, mid - 0.5 - up, COLUMN - 0.6, up, 0.8)
    ctx.fill()

    if (sample.mic !== undefined) {
      const down = barHeight(sample.mic, HALF, 0.6)
      ctx.fillStyle = self
      ctx.beginPath()
      ctx.roundRect(x, mid + 0.5, COLUMN - 0.6, down, 0.8)
      ctx.fill()
    }
  })
  ctx.globalAlpha = 1

  ctx.fillStyle = cssVar('--border')
  ctx.fillRect(0, mid - 0.5, WIDTH, 1)

  // マイクが取れていないことは、無音（小さな棒）と見分けがつくよう破線で囲む。
  if (history.length > 0 && history[history.length - 1]?.mic === undefined) {
    ctx.strokeStyle = cssVar('--warning')
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.strokeRect(0.5, mid + 1.5, WIDTH - 1, HALF - 1)
    ctx.setLineDash([])
  }
}

/**
 * 直近 10 秒の入力レベルを、中央線を挟んだ上下の波形で出す（上＝相手、下＝自分）。
 * 履歴は React の state に載せず、ここのタイマーで読んで canvas に描く。
 * ウィンドウが隠れている間は描かない。
 */
export const LevelTimeline = ({
  active,
  readHistory,
  title
}: {
  active: boolean
  readHistory: () => readonly LevelSample[]
  title: string
}): ReactElement => {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvas.current
    const ctx = element?.getContext('2d')
    if (!element || !ctx) return undefined

    const scale = window.devicePixelRatio || 1
    element.width = WIDTH * scale
    element.height = HEIGHT * scale
    ctx.setTransform(scale, 0, 0, scale, 0, 0)

    if (!active) {
      paint(ctx, [])
      return undefined
    }

    const draw = (): void => {
      if (!document.hidden) paint(ctx, readHistory())
    }
    draw()
    const timer = window.setInterval(draw, LEVEL_SAMPLE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [active, readHistory])

  return (
    <div className="transport__meter" title={title}>
      <canvas ref={canvas} role="img" aria-label={title} />
    </div>
  )
}
