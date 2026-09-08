/**
 * 「録りっぱなし」を防ぐための無音の見張り。
 *
 * 会議が終わってもアプリを止め忘れると、無音だけの長い録音が残り、
 * 文字起こしと要約に無駄な時間とメモリを使う。相手もこちらも一定時間
 * 何も鳴らしていないなら、会議はもう終わっている可能性が高い。
 *
 * ここは時計もタイマーも持たない純粋な状態遷移に閉じてある。
 * 実際の観測（PCM の peak）と通知は外側の仕事。
 */

/**
 * これ以下の peak は無音とみなす既定値。
 *
 * マイクは無音でも環境ノイズで完全な 0 にはならないため、0 ではなく
 * わずかな余裕を持たせる。会議の発話はこれをはるかに超える。
 */
export const DEFAULT_SILENCE_LEVEL = 0.02

/**
 * 標本のうちこの割合以上が無音なら「無音が続いている」とみなす既定値。
 *
 * 1 つでも音があれば数え直す方式にすると、会議の後で机に戻ってキーボードを
 * 打っているだけで計測が延々と振り出しに戻り、いつまでも知らせられない。
 * 逆に許容しすぎると会話中に誤って知らせるため、10% までとする
 * （5 分なら 30 秒ぶん。会議が続いているならこれを超える）。
 */
export const DEFAULT_QUIET_RATIO = 0.9

export interface SilenceWatchOptions {
  /** これ以下の peak（0〜1）を無音とみなす。 */
  readonly level: number
  /** 無音がこの時間続いたら知らせる。 */
  readonly durationMs: number
  /** 計測中の標本のうち無音であるべき割合（0〜1）。 */
  readonly quietRatio: number
}

export interface SilenceWatchState {
  /** 無音の計測を始めた時刻。計測していない間は undefined。 */
  readonly silentSinceMs: number | undefined
  /** 計測を始めてから観測した標本の数。 */
  readonly samples: number
  /** そのうち無音だった数。 */
  readonly quietSamples: number
}

export const initialSilenceWatch = (): SilenceWatchState => ({
  silentSinceMs: undefined,
  samples: 0,
  quietSamples: 0
})

/** 指定の時刻から計測をやり直す。「続ける」を選ばれたときに使う。 */
export const restartSilenceWatch = (atMs: number): SilenceWatchState => ({
  silentSinceMs: atMs,
  samples: 0,
  quietSamples: 0
})

/**
 * 入力レベルを 1 つ観測し、知らせるべきかを返す。
 *
 * 判定は「区間のうち何割が無音か」で行う。1 秒だけの物音（打鍵やドアの音）では
 * 割合がほとんど動かないので計測は続き、会話が始まれば割合が崩れて数え直しになる。
 *
 * 知らせた後は計測の起点をその時刻へ進めるため、無音が続く限り同じ間隔で
 * 繰り返し知らせることになる。1 回で黙ってしまうと、通知を見逃した場合に
 * 目的（止め忘れの防止）を果たせない。
 */
export const observeLevel = (
  state: SilenceWatchState,
  sample: { level: number; atMs: number },
  options: SilenceWatchOptions
): { state: SilenceWatchState; alert: boolean } => {
  const quiet = sample.level <= options.level

  // まだ計測していないなら、無音の標本が来たところから数え始める。
  if (state.silentSinceMs === undefined) {
    return {
      state: quiet ? { silentSinceMs: sample.atMs, samples: 1, quietSamples: 1 } : state,
      alert: false
    }
  }

  const samples = state.samples + 1
  const quietSamples = state.quietSamples + (quiet ? 1 : 0)

  // 音が混ざりすぎた＝会議はまだ続いている。次の無音から数え直す。
  if (quietSamples / samples < options.quietRatio) {
    return { state: initialSilenceWatch(), alert: false }
  }

  if (sample.atMs - state.silentSinceMs >= options.durationMs) {
    return {
      state: { silentSinceMs: sample.atMs, samples: 1, quietSamples: quiet ? 1 : 0 },
      alert: true
    }
  }

  return { state: { silentSinceMs: state.silentSinceMs, samples, quietSamples }, alert: false }
}
