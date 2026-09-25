import type { ReactElement } from 'react'
import { formatDuration } from '../format'
import { formatPlaybackRate, volumeLevel } from '../library/playback'

/**
 * 独自の再生の操作。再生・停止、位置と全長、速度、音量を 1 行に並べる。
 *
 * シークバーは置かない。下の話者の帯がどこを押してもその位置へ飛べるので同じ役目を
 * 果たし、2 本並べると同じ操作の場所が二手に分かれる。
 */
export const PlayerControls = ({
  playing,
  positionMs,
  durationMs,
  rate,
  volume,
  muted,
  disabled,
  onToggle,
  onChangeRate,
  onChangeVolume,
  onToggleMute
}: {
  playing: boolean
  positionMs: number
  durationMs: number
  rate: number
  volume: number
  muted: boolean
  disabled: boolean
  onToggle: () => void
  onChangeRate: () => void
  onChangeVolume: (volume: number) => void
  onToggleMute: () => void
}): ReactElement => {
  const level = volumeLevel(volume, muted)

  return (
    <div className="player-controls">
      <button
        type="button"
        className="player-controls__play"
        aria-label={playing ? '一時停止' : '再生'}
        title={disabled ? 'エンコードが終わると再生できます' : `${playing ? '一時停止' : '再生'}（Space）`}
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
      <div className="player-controls__volume">
        <button
          type="button"
          className="player-controls__mute"
          aria-label={level === 'muted' ? 'ミュートを解除' : 'ミュート'}
          title={level === 'muted' ? 'ミュートを解除' : 'ミュート'}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleMute}
        >
          <VolumeIcon level={level} />
        </button>
        <input
          type="range"
          className="player-controls__volume-slider"
          aria-label="音量"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          disabled={disabled}
          onChange={(event) => onChangeVolume(Number(event.target.value))}
        />
      </div>
    </div>
  )
}

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

/** スピーカーに、音量の段階に応じて波（low は 1 本、high は 2 本）かバツを添える。 */
const VolumeIcon = ({ level }: { level: 'muted' | 'low' | 'high' }): ReactElement => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
  >
    <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" stroke="none" />
    {level === 'muted' ? (
      <path d="M10.5 6l4 4M14.5 6l-4 4" />
    ) : (
      <>
        <path d="M10.5 6a2.5 2.5 0 0 1 0 4" />
        {level === 'high' && <path d="M12.5 4a5 5 0 0 1 0 8" />}
      </>
    )}
  </svg>
)
