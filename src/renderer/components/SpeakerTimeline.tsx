import type { MouseEvent, ReactElement } from 'react'
import { seekTargetMs, type SpeakerLane } from '../library/timeline'

/**
 * 話者ごとの発言の帯。会議の流れ（いつ誰が話していたか）を一目で見せ、押した位置へ飛ぶ。
 *
 * 材料は文字起こしの区間だけで、追加の推論はしない。音声ができるまでは置いたまま
 * 無効に見せる（隠すと、エンコードが終わった瞬間に下の欄が押し下げられる）。
 */
export const SpeakerTimeline = ({
  lanes,
  tones,
  durationMs,
  positionMs,
  disabled,
  onSeek
}: {
  lanes: readonly SpeakerLane[]
  tones: ReadonlyMap<string, number>
  durationMs: number
  positionMs: number
  disabled: boolean
  onSeek: (ms: number) => void
}): ReactElement | null => {
  if (lanes.length === 0 || durationMs <= 0) return null

  const percent = (ms: number): string => `${(Math.min(ms, durationMs) / durationMs) * 100}%`

  const seekFrom = (lane: SpeakerLane, event: MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    onSeek(seekTargetMs(lane.spans, (event.clientX - rect.left) / rect.width, durationMs))
  }

  return (
    <div
      className={disabled ? 'timeline timeline--disabled' : 'timeline'}
      aria-disabled={disabled}
    >
      <div className="timeline__labels">
        {lanes.map((lane) => (
          <span key={lane.speakerId} className="timeline__label" title={lane.label}>
            {lane.label}
          </span>
        ))}
      </div>

      <div className="timeline__tracks">
        {lanes.map((lane) => (
          <button
            key={lane.speakerId}
            type="button"
            className={`timeline__track tone-${tones.get(lane.speakerId) ?? 0}`}
            aria-label={`${lane.label}の発言の帯。押した発言から再生`}
            disabled={disabled}
            // 押してもフォーカスを奪わない。本文を直している最中に聞き直すと、
            // 編集欄の blur で直しかけの本文が確定されてしまうため（時刻のボタンと同じ）。
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => seekFrom(lane, event)}
          >
            {lane.spans.map((span, index) => (
              <span
                key={`${span.startMs}-${index}`}
                className="timeline__span"
                style={{ left: percent(span.startMs), width: percent(span.endMs - span.startMs) }}
              />
            ))}
          </button>
        ))}
        <span
          className="timeline__playhead"
          aria-hidden="true"
          style={{ left: percent(positionMs) }}
        />
      </div>
    </div>
  )
}
