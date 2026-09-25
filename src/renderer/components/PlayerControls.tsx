import type { ReactElement } from 'react'
import { formatDuration } from '../format'
import { formatPlaybackRate } from '../library/playback'

/**
 * 独自の再生の操作。再生・停止、位置と全長、速度だけを持つ。
 *
 * シークバーは置かない。位置の移動は下の話者の帯と発言の時刻が担い、
 * 「誰の発言へ飛ぶか」で選べる方が会議録では目的に合う。
 * 音量も置かない — システムの音量で足り、欄を狭めるだけになる。
 */
export const PlayerControls = ({
  playing,
  positionMs,
  durationMs,
  rate,
  disabled,
  onToggle,
  onChangeRate
}: {
  playing: boolean
  positionMs: number
  durationMs: number
  rate: number
  disabled: boolean
  onToggle: () => void
  onChangeRate: () => void
}): ReactElement => (
  <div className="player-controls">
    <button
      type="button"
      className="player-controls__play"
      aria-label={playing ? '一時停止' : '再生'}
      title={disabled ? 'エンコードが終わると再生できます' : undefined}
      disabled={disabled}
      // 押してもフォーカスを奪わない。ボタンにフォーカスが残ると、次の Space が
      // ボタンの押下になり、Space の再生・停止と挙動が食い違う。
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
    >
      {playing ? <PauseIcon /> : <PlayIcon />}
    </button>
    <span className="player-controls__time">
      {formatDuration(positionMs)} / {formatDuration(durationMs)}
    </span>
    <button
      type="button"
      className="player-controls__rate"
      aria-label={`再生速度 ${formatPlaybackRate(rate)}（押すたびに切り替え）`}
      title="再生速度（押すたびに切り替え）"
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onChangeRate}
    >
      {formatPlaybackRate(rate)}
    </button>
    <span className="player-controls__hint">
      発言の時刻や帯を押すとその位置へ ・ <kbd>Space</kbd> 再生
    </span>
  </div>
)

const PlayIcon = (): ReactElement => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
  </svg>
)

const PauseIcon = (): ReactElement => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" />
  </svg>
)
