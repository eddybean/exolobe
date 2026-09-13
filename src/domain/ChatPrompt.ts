/**
 * チャットでモデルに渡す指示文。
 *
 * 要約プロンプト（DEFAULT_SUMMARY_PROMPT）と違い、設定で編集できるようにしない。
 * ここには「文脈だけを根拠にする」「[1] の形で引用する」という出力の契約が
 * 含まれていて、画面の引用表示がそれに依存する。書き換えられると UI が黙って壊れる。
 */

export const CONTEXT_PLACEHOLDER = '{{context}}'
export const QUESTION_PLACEHOLDER = '{{question}}'

export const DEFAULT_CHAT_SYSTEM_PROMPT = [
  'あなたは、利用者の会議記録だけを見て質問に答えるアシスタントです。',
  '',
  '守ること:',
  '- 与えられた会議記録に書かれていることだけを根拠にする。書かれていないことは推測せず、',
  '  「記録からは分かりません」とはっきり答える。',
  '- 会議を指すときは [1] [2] のように、記録の見出しに付いた番号で示す。',
  '- 日本語で、結論から簡潔に答える。項目が並ぶ場合は箇条書きにする。',
  '- 日付・数値・人名・会社名は記録のとおりに写す。丸めたり言い換えたりしない。',
  '- 記録に見つからない場合は、期間や言葉を変えて尋ね直すよう促す。'
].join('\n')

export const DEFAULT_CHAT_PROMPT = [
  '# 会議記録',
  CONTEXT_PLACEHOLDER,
  '',
  '# 質問',
  QUESTION_PLACEHOLDER,
  '',
  '上の会議記録だけを根拠に、日本語で答えてください。',
  '根拠にした会議は、答えの中で [1] のように番号で示してください。'
].join('\n')

/** 文脈が空のときにそう書く。空欄のまま渡すと、モデルが記憶から会議を作り出す。 */
const EMPTY_CONTEXT = '（該当する会議の記録はありません）'

const fill = (template: string, placeholder: string, value: string): string =>
  template.includes(placeholder) ? template.split(placeholder).join(value) : template

export const renderChatPrompt = (
  template: string,
  params: { readonly context: string; readonly question: string }
): string => {
  const context = params.context.trim() || EMPTY_CONTEXT
  const filled = fill(fill(template, CONTEXT_PLACEHOLDER, context), QUESTION_PLACEHOLDER, params.question)

  // 差し込み位置を持たないテンプレートでも、文脈と質問は必ず届ける。
  if (filled.includes(context) && filled.includes(params.question)) return filled
  return [filled, '', '# 会議記録', context, '', '# 質問', params.question].join('\n')
}
