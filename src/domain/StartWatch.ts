/**
 * 「録音の開始忘れ」を防ぐためのマイク使用の見張り。
 *
 * 会議が始まっているのに録音ボタンを押し忘れると、会議の内容そのものが失われる。
 * 止め忘れ（SilenceWatch）が無駄なファイルを残すだけなのに比べ、損失が大きい。
 * 他のアプリがマイクを使い続けているなら、通話が始まっている可能性が高い。
 *
 * SilenceWatch の鏡像で、ここも時計もタイマーも持たない純粋な状態遷移に閉じてある。
 * 実際の観測（マイクの使用状態）と通知は外側の仕事。
 */

/**
 * 標本のうちこの割合以上が「使用中」なら会議が続いているとみなす既定値。
 *
 * SilenceWatch の quietRatio と同じ理由で割合判定にする。1 標本でも空きがあれば
 * 数え直す方式にすると、会議アプリがデバイスを一瞬掴み直すだけで計測が振り出しに
 * 戻る。逆に許容しすぎると、短い音声入力や Siri で誤って知らせてしまう。
 */
export const DEFAULT_BUSY_RATIO = 0.9

export interface StartWatchOptions {
  /** マイクの使用がこの時間続いたら知らせる。 */
  readonly durationMs: number
  /** 計測中の標本のうち使用中であるべき割合（0〜1）。 */
  readonly busyRatio: number
}

export interface StartWatchState {
  /** 使用の計測を始めた時刻。計測していない間は undefined。 */
  readonly busySinceMs: number | undefined
  /** 計測を始めてから観測した標本の数。 */
  readonly samples: number
  /** そのうち使用中だった数。 */
  readonly busySamples: number
  /**
   * 知らせ終えた、あるいは「今はしない」を選ばれた状態。
   *
   * マイクが空くまでは何も言わない。止め忘れと違い、一度「録音しない」と決めた
   * 会議の最中に繰り返し通知が来るのは邪魔でしかない。通知を見逃した場合は
   * アプリ内の確認バーが残っているので気づけなくならない。
   */
  readonly silenced: boolean
}

export const initialStartWatch = (): StartWatchState => ({
  busySinceMs: undefined,
  samples: 0,
  busySamples: 0,
  silenced: false
})

/** 利用者が「今はしない」を選んだ。マイクが空くまで黙る。 */
export const dismissStartWatch = (state: StartWatchState): StartWatchState => ({
  ...state,
  silenced: true
})

/**
 * マイクの使用状態を 1 つ観測し、知らせるべきかを返す。
 *
 * 知らせた後は自動的に silenced になり、マイクが空いたところで計測をやり直す。
 * そのため 1 つの会議につき通知は 1 回で、会議を抜けて次の会議に入れば再び届く。
 */
export const observeMicUsage = (
  state: StartWatchState,
  sample: { inUse: boolean; atMs: number },
  options: StartWatchOptions
): { state: StartWatchState; alert: boolean } => {
  // 黙っている間は、マイクが空くまで何も数えない。
  if (state.silenced) {
    return { state: sample.inUse ? state : initialStartWatch(), alert: false }
  }

  // まだ計測していないなら、使用中の標本が来たところから数え始める。
  if (state.busySinceMs === undefined) {
    return {
      state: sample.inUse
        ? { busySinceMs: sample.atMs, samples: 1, busySamples: 1, silenced: false }
        : state,
      alert: false
    }
  }

  const samples = state.samples + 1
  const busySamples = state.busySamples + (sample.inUse ? 1 : 0)

  // 空きが混ざりすぎた＝通話ではない。次の使用から数え直す。
  if (busySamples / samples < options.busyRatio) {
    return { state: initialStartWatch(), alert: false }
  }

  if (sample.atMs - state.busySinceMs >= options.durationMs) {
    return { state: { ...state, samples, busySamples, silenced: true }, alert: true }
  }

  return {
    state: { busySinceMs: state.busySinceMs, samples, busySamples, silenced: false },
    alert: false
  }
}
