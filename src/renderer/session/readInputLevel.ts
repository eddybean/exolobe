/**
 * 音量メーターに出す入力レベルの決め方。
 *
 * メーターは「今この録音に音が入っているか」を示すものなので、マイクだけでなく
 * デスクトップ音声も含めた大きい方を出す。相手だけが喋っている時間はマイクが
 * 無音なので、マイクしか見ないと「録れていない」と誤解させてしまう。
 */
export const readInputLevel = async (params: {
  /** レンダラーで取得しているマイクの peak。マイクを取れていなければ undefined。 */
  micLevel: (() => number) | undefined
  /** main 側が保持しているデスクトップ音声の peak。 */
  systemLevel: () => Promise<number>
}): Promise<number> => {
  const mic = params.micLevel?.() ?? 0

  // 停止直後など、main 側が録音中でない瞬間に取りに行くと失敗しうる。
  // メーターの表示のためだけの値なので、取れなければ無音として扱う。
  const system = await params.systemLevel().catch(() => 0)

  return Math.max(mic, system)
}
