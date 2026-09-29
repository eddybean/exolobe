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
