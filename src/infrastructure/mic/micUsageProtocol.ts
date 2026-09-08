/**
 * micwatch との取り決め。
 *
 * 状態が変わったときだけ `1`（どこかでマイクが使われている）か `0` を 1 行出す。
 * 想定外の行（将来のログ出力など）は無視して、見張りを止めないようにする。
 */
export const parseMicUsageLine = (line: string): boolean | undefined => {
  const value = line.trim()
  if (value === '1') return true
  if (value === '0') return false
  return undefined
}
