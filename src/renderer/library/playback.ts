/**
 * 再生速度の並び。押すたびに次へ進み、最後から最初へ戻る。
 * 聞き返す用途の 0.75 倍は、速めて聞くのが主な使い方なので末尾に置く。
 */
export const PLAYBACK_RATES: readonly number[] = [1, 1.25, 1.5, 2, 0.75]

export const nextPlaybackRate = (current: number): number => {
  const index = PLAYBACK_RATES.indexOf(current)
  if (index < 0) return 1
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? 1
}

export const formatPlaybackRate = (rate: number): string => `${rate}×`

/**
 * どちらのプレーヤーで再生するか。
 *
 * 独自の操作にはシークバーが無く、位置の移動は話者の帯と発言の時刻が担う。
 * 文字起こしが無い（失敗した・まだ無い）録音では帯が出ず位置を動かせないので、
 * 標準のプレーヤーに戻す。
 */
export const playerMode = (segmentCount: number): 'custom' | 'native' =>
  segmentCount > 0 ? 'custom' : 'native'

export interface PlaybackKeyEvent {
  readonly key: string
  readonly repeat: boolean
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly isComposing: boolean
  /** フォーカスのある要素の tagName（大文字）。 */
  readonly targetTag: string
  /** フォーカスのある要素が input のときの type。それ以外は空文字。 */
  readonly targetInputType: string
  readonly targetEditable: boolean
  readonly modalOpen: boolean
}

/**
 * Space を押しても、そのキーが本来の役目を持つ要素（文字の入力・ボタンの押下・標準の
 * プレーヤー自身）には奪わない。奪うと本文に空白が打てない、ボタンと二重に動く、になる。
 * スライダー（音量）は Space を使わないので奪う — 動かした直後はフォーカスが
 * スライダーに残り、ここで効かないと動かすたびに Space が効かなくなる。
 */
const KEEPS_SPACE = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'AUDIO'])

/** 詳細画面で Space を再生・停止に使ってよいか。 */
export const isPlaybackToggleKey = (event: PlaybackKeyEvent): boolean =>
  event.key === ' ' &&
  !event.repeat &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.isComposing &&
  !event.modalOpen &&
  !event.targetEditable &&
  (event.targetInputType === 'range' || !KEEPS_SPACE.has(event.targetTag))

/** 音量のアイコンの段階。音量 0 はミュートと同じく鳴らないので同じ見た目にする。 */
export const volumeLevel = (volume: number, muted: boolean): 'muted' | 'low' | 'high' => {
  if (muted || volume <= 0) return 'muted'
  return volume < 0.5 ? 'low' : 'high'
}
