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
  '答え方:',
  '- 質問に当てはまる内容を、会議をまたいで集めて答える。',
  '- 会議ごとに見出しを立てて並べない。会議の一覧は答えではない。',
  '  「会議ごとにまとめて」と頼まれたときだけ会議ごとに分ける。',
  '- 同じ内容が複数の会議にあれば 1 つにまとめる。',
  '- 答えの形は質問に合わせて選ぶ:',
  '  - やること・タスクを尋ねられたら `- [ ] ` のチェックボックスにし、',
  '    担当者と期限が記録にあれば項目の中に併記する',
  '  - 決定事項のように項目が並ぶものは箇条書きにする',
  '  - 経緯や流れ、理由を尋ねられたら短い段落で書く',
  '  - 数や期間を比べるものは表にする',
  '- 各項目の末尾に、根拠にした会議の番号を [1] の形で置く。番号は記録の見出しのもの。',
  '  会議の名前や日付は書かない（番号から利用者の画面で補われる）。',
  '- 前置きは 1 文まで。答えの後に感想や補足を足さない。',
  '',
  '守ること:',
  '- 与えられた会議記録に書かれていることだけを根拠にする。書かれていないことは推測しない。',
  '- 日付・数値・人名・会社名は記録のとおりに写す。丸めたり言い換えたりしない。',
  '- 当てはまる記述が無ければ「記録からは分かりません」とはっきり答え、',
  '  期間や言葉を変えて尋ね直すよう促す。'
].join('\n')

export const DEFAULT_CHAT_PROMPT = [
  '# 会議記録',
  CONTEXT_PLACEHOLDER,
  '',
  '# 質問',
  QUESTION_PLACEHOLDER,
  '',
  '上の会議記録だけを根拠に、日本語で答えてください。',
  '会議の一覧を並べるのではなく、質問に当てはまる内容を答えてください。',
  '答えの形は質問に合うものを選び、根拠にした会議の番号を [1] の形で添えてください。'
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
  const base = fill(
    fill(template, CONTEXT_PLACEHOLDER, context),
    QUESTION_PLACEHOLDER,
    params.question
  )

  // 差し込み位置を持たないテンプレートでも、文脈と質問は必ず届ける。
  return base.includes(context) && base.includes(params.question)
    ? base
    : [base, '', '# 会議記録', context, '', '# 質問', params.question].join('\n')
}
