/**
 * 音量メーターに出す入力レベルの決め方。
 *
 * メーターは「今この録音に音が入っているか」を示すものなので、マイクだけでなく
 * デスクトップ音声も含めた大きい方を出す。相手だけが喋っている時間はマイクが
 * 無音なので、マイクしか見ないと「録れていない」と誤解させてしまう。
 */
export const combinedLevel = (levels: {
  readonly mic: number | undefined
  readonly system: number
}): number => Math.max(levels.mic ?? 0, levels.system)

export interface LevelSources {
  /** レンダラーで取得しているマイクの peak。マイクを取れていなければ undefined。 */
  readonly micLevel: (() => number) | undefined
  /** main 側が保持しているデスクトップ音声の peak。 */
  readonly systemLevel: () => Promise<number>
}

/**
 * 録音中の画面で 2 トラックを分けて出すためのレベル。
 * マイクが取れていないことは「無音」と見分けて出したいので undefined のまま返す。
 */
export const readTrackLevels = async (
  params: LevelSources
): Promise<{ mic: number | undefined; system: number }> => {
  const mic = params.micLevel?.()

  // 停止直後など、main 側が録音中でない瞬間に取りに行くと失敗しうる。
  // メーターの表示のためだけの値なので、取れなければ無音として扱う。
  const system = await params.systemLevel().catch(() => 0)

  return { mic, system }
}
