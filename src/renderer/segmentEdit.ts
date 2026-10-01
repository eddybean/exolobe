/**
 * 本文を末尾の 1 文字とそれ以外に分ける。ペンのアイコンを末尾の文字と折り返し不可で
 * 結ぶためで、そうしないと行末いっぱいの発言でアイコンだけが次の行に落ちて空行に見える。
 * 絵文字などのサロゲートペアを割らないよう、コードポイント単位で切る。
 */
export const splitTrailingChar = (text: string): [string, string] => {
  const chars = Array.from(text)
  const last = chars.pop() ?? ''
  return [chars.join(''), last]
}

/**
 * 本文を押したときに編集へ入るか。範囲を選び終えたときにも click は届くので、
 * 選択が残っていれば入らない —— 本文はコピーのために選ばれることが多い。
 */
export const shouldStartEditOnTextClick = (selectedText: string): boolean => selectedText.length === 0
