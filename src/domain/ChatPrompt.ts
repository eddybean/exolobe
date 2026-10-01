import type { MeetingLanguage } from '@domain/MeetingLanguage'

/**
 * チャットでモデルに渡す指示文。
 *
 * 要約プロンプト（DEFAULT_SUMMARY_PROMPT）と違い、設定で編集できるようにしない。
 * ここには「文脈だけを根拠にする」「[1] の形で引用する」という出力の契約が
 * 含まれていて、画面の引用表示がそれに依存する。書き換えられると UI が黙って壊れる。
 *
 * 問いの言語ごとに持つ（ADR-043）。英語版も契約は日本語版と同じにする。片方だけ直すと、
 * 言語によって引用が出たり出なかったりする。
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

export const DEFAULT_CHAT_SYSTEM_PROMPT_EN = [
  "You are an assistant that answers questions using only the user's meeting records.",
  '',
  'How to answer:',
  '- Gather what matches the question across meetings and answer with it.',
  '- Do not list meetings one by one under their own headings. A list of meetings is not an answer.',
  '  Group by meeting only when asked to summarize meeting by meeting.',
  '- If the same point appears in several meetings, state it once.',
  '- Choose the shape of the answer to fit the question:',
  '  - For to-dos or tasks, use `- [ ] ` checkboxes and include the owner and due date',
  '    in the item when the records give them',
  '  - For lists such as decisions, use bullet points',
  '  - For background, flow, or reasons, write short paragraphs',
  '  - For comparing numbers or periods, use a table',
  '- End each item with the number of the meeting it is based on, in the form [1]. The number',
  '  is the one in the record heading. Do not write meeting names or dates (the app fills them',
  "  in from the number on the user's screen).",
  '- Keep any preamble to one sentence. Do not add impressions or extra notes after the answer.',
  '',
  'Rules:',
  '- Base the answer only on what is written in the given meeting records. Do not guess.',
  '- Copy dates, numbers, names of people, and company names exactly as recorded.',
  '  Do not round or paraphrase them.',
  '- If nothing in the records matches, say clearly "The records do not say." and suggest',
  '  asking again with a different period or wording.'
].join('\n')

export const DEFAULT_CHAT_PROMPT_EN = [
  '# Meeting records',
  CONTEXT_PLACEHOLDER,
  '',
  '# Question',
  QUESTION_PLACEHOLDER,
  '',
  'Answer in English, based only on the meeting records above.',
  'Do not list the meetings; answer with what matches the question.',
  'Choose a shape that fits the question and cite the meeting numbers you used in the form [1].'
].join('\n')

const PROMPTS: Readonly<Record<MeetingLanguage, { readonly system: string; readonly prompt: string }>> = {
  ja: { system: DEFAULT_CHAT_SYSTEM_PROMPT, prompt: DEFAULT_CHAT_PROMPT },
  en: { system: DEFAULT_CHAT_SYSTEM_PROMPT_EN, prompt: DEFAULT_CHAT_PROMPT_EN }
}

/** 問いの言語の指示文。 */
export const chatPrompts = (language: MeetingLanguage): { readonly system: string; readonly prompt: string } =>
  PROMPTS[language]

/** 文脈が空のときにそう書く。空欄のまま渡すと、モデルが記憶から会議を作り出す。 */
const EMPTY_CONTEXT: Readonly<Record<MeetingLanguage, string>> = {
  ja: '（該当する会議の記録はありません）',
  en: '(No meeting records match.)'
}

/** 差し込み位置を持たないテンプレートに足す見出し。 */
const FALLBACK_HEADINGS: Readonly<Record<MeetingLanguage, { readonly context: string; readonly question: string }>> = {
  ja: { context: '# 会議記録', question: '# 質問' },
  en: { context: '# Meeting records', question: '# Question' }
}

const fill = (template: string, placeholder: string, value: string): string =>
  template.includes(placeholder) ? template.split(placeholder).join(value) : template

export const renderChatPrompt = (
  template: string,
  language: MeetingLanguage,
  params: { readonly context: string; readonly question: string }
): string => {
  const context = params.context.trim() || EMPTY_CONTEXT[language]
  const headings = FALLBACK_HEADINGS[language]
  const base = fill(fill(template, CONTEXT_PLACEHOLDER, context), QUESTION_PLACEHOLDER, params.question)

  // 差し込み位置を持たないテンプレートでも、文脈と質問は必ず届ける。
  return base.includes(context) && base.includes(params.question)
    ? base
    : [base, '', headings.context, context, '', headings.question, params.question].join('\n')
}
