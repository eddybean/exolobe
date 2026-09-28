/**
 * 用語集（カスタム語彙）を whisper の initial prompt に変換する純粋な計算。
 *
 * whisper は直前の文脈として与えた文に語彙と表記を引きずられる性質があり、社名・製品名・
 * 人名をあらかじめ見せておくと、そこだけ音の近い一般語に化けるのを防げる。
 * 何を登録するかは利用者が決め、ここは「渡せる形に整えて上限で切る」ところだけを持つ。
 */

/**
 * プロンプトに使える文字数の上限。
 *
 * whisper-cli の `--prompt` は `n_text_ctx/2` トークン（既定のモデルで 224）までで、
 * 超えた分は whisper 側が黙って切り捨てる。日本語は 1 文字が 1 トークンを超えることも
 * あるため、切られる位置をこちらで決められるよう文字数で余裕をもって止める。
 * 途中で切れた用語が中途半端に残るより、入り切らない用語を落としたほうが害が小さい。
 */
export const GLOSSARY_PROMPT_LIMIT = 200

/** 編集欄の 1 行 1 語をそのまま用語集にする。空行と重複は落とす。 */
export const parseGlossary = (input: string): string[] => {
  const terms = input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return [...new Set(terms)]
}

/** 用語集を編集欄に戻す。`parseGlossary` の逆。 */
export const formatGlossary = (terms: readonly string[]): string => terms.join('\n')

/**
 * 用語集を whisper に渡す 1 文にする。用語が無ければ空文字（＝渡さない合図）。
 *
 * 区切りでつなぐだけの列挙にする。説明文を添えると、その文体まで文字起こしに移る。
 * 区切りの記号も文字起こしに移るので、英語の会議ではカンマとピリオドにする。自動判定では
 * 従来どおり読点にし、日本語の会議の結果を変えない。
 *
 * @param language whisper に渡す文字起こしの言語（`auto` を含む）
 */
export const glossaryPrompt = (terms: readonly string[], language: string): string => {
  const [separator, end] = language === 'en' ? [', ', '.'] : ['、', '。']
  const sentence = (included: readonly string[]): string =>
    included.length === 0 ? '' : `${included.join(separator)}${end}`

  const accepted: string[] = []
  for (const term of terms) {
    if (sentence([...accepted, term]).length > GLOSSARY_PROMPT_LIMIT) break
    accepted.push(term)
  }

  return sentence(accepted)
}
