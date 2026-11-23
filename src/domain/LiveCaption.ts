/**
 * 録音中のライブ字幕の表示状態（ADR-050）。
 *
 * 認識器（SpeechAnalyzer）は発話の途中で書きかけ（volatile）を何度も送り直し、
 * 切れ目で確定（final）を 1 回送る。画面に出すのは「確定した行」と「トラックごとに書きかけ 1 行」で、
 * 確定が来たらその範囲の書きかけを置き換える。
 *
 * 字幕は表示のためだけのもので保存しない。録音後の文字起こし（whisper）が正本で、
 * 字幕を残すと精度の違う 2 つの記録が並ぶ（ADR-050）。上限を超えた行は捨ててよい。
 */

/** remote = システム音声（相手）、self = マイク（自分）。録音の 2 トラックと同じ分け方。 */
export type CaptionTrack = 'remote' | 'self'

export interface CaptionEvent {
  readonly track: CaptionTrack
  readonly kind: 'volatile' | 'final'
  readonly text: string
  /** 録音の開始からの時刻。 */
  readonly startMs: number
  readonly endMs: number
}

export interface CaptionLine {
  readonly track: CaptionTrack
  readonly text: string
  readonly startMs: number
  readonly endMs: number
  /** 書きかけなら true。画面は薄く出す。 */
  readonly pending: boolean
  /** 上限で先頭を切り詰めたなら true。画面が省略の印を付ける。 */
  readonly clipped?: true
}

export interface CaptionLimits {
  /** 確定した行を何行まで持つか。 */
  readonly maxLines: number
  /** 1 行の文字数の上限。 */
  readonly maxChars: number
}

/**
 * 字幕の枠は数行ぶんの高さしか無く、さかのぼって読むなら録音後の文字起こしを見る。
 * 1 時間の会議でも数百行に収まるが、描画の量を抑えるため 200 行で切る。
 * 合成音声のように間を置かずに話し続けると確定 1 回が 100 字を超えたので、1 行は 240 字まで。
 */
export const DEFAULT_CAPTION_LIMITS: CaptionLimits = { maxLines: 200, maxChars: 240 }

export interface LiveCaptionState {
  /** 確定した行。話し始めた時刻の順。 */
  readonly finals: readonly CaptionLine[]
  readonly pending: Readonly<Partial<Record<CaptionTrack, CaptionLine>>>
}

export const initialLiveCaption = (): LiveCaptionState => ({ finals: [], pending: {} })

const toLine = (event: CaptionEvent, limits: CaptionLimits): CaptionLine => {
  const text = event.text.trim()
  const clipped = text.length > limits.maxChars
  return {
    track: event.track,
    // 書きかけは末尾が伸びていくので、切るなら古い先頭の側を落とす。
    text: clipped ? text.slice(text.length - limits.maxChars) : text,
    startMs: event.startMs,
    endMs: event.endMs,
    pending: event.kind === 'volatile',
    ...(clipped ? { clipped: true as const } : {})
  }
}

const withoutTrack = (pending: LiveCaptionState['pending'], track: CaptionTrack): LiveCaptionState['pending'] => {
  const { [track]: _removed, ...rest } = pending
  return rest
}

export const applyCaptionEvent = (
  state: LiveCaptionState,
  event: CaptionEvent,
  limits: CaptionLimits = DEFAULT_CAPTION_LIMITS
): LiveCaptionState => {
  if (event.kind === 'volatile') {
    return { ...state, pending: { ...state.pending, [event.track]: toLine(event, limits) } }
  }

  // 確定より後から始まる書きかけは次の発話のものなので残す。
  const current = state.pending[event.track]
  const pending = current && current.startMs < event.endMs ? withoutTrack(state.pending, event.track) : state.pending

  if (event.text.trim() === '') return { ...state, pending }

  const finals = [...state.finals, toLine(event, limits)].sort((a, b) => a.startMs - b.startMs).slice(-limits.maxLines)
  return { finals, pending }
}

/** 画面に出す行。確定と書きかけを話し始めた時刻の順に混ぜる。 */
export const captionLines = (state: LiveCaptionState): CaptionLine[] =>
  [...state.finals, ...Object.values(state.pending).filter((line): line is CaptionLine => line !== undefined)].sort(
    (a, b) => a.startMs - b.startMs
  )

/**
 * ライブ字幕の認識器（SpeechAnalyzer）が使えるか（ADR-050）。設定画面で、使えない理由を出し分ける。
 */
export type LiveCaptionAvailability =
  | 'available'
  /** macOS 26 未満。SpeechAnalyzer が無い。 */
  | 'unsupported-os'
  /** 会議の言語を認識できない。 */
  | 'unsupported-locale'
  /** 上のどれでもない理由で使えない。 */
  | 'unavailable'
  /** 同梱の livetranscribe が無い（Windows や、開発環境でまだ作っていないなど）。 */
  | 'missing'

export interface LiveCaptionStatus {
  readonly availability: LiveCaptionAvailability
  /** 使えるときだけ。downloadable なら、初めて録音するときに OS がモデルを取得する。 */
  readonly assets?: 'installed' | 'downloadable'
}
