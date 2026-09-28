import { localized } from './locale'

/** チャット画面（ChatView / chat/messages.ts）の文言。 */

const ja = {
  heading: 'チャット',
  lead: '録音・文字起こし・要約をもとに答えます。処理はすべてこの Mac の中で完結します。',
  newConversation: '新しい会話',
  emptyHint: '期間や話し手で絞って尋ねられます。',
  examples: [
    '先週のTODOをまとめて',
    '先週の自分の発言だけを要約して',
    '今月の決定事項を一覧にして'
  ] as readonly string[],
  composerPlaceholder: '先週のTODOをまとめて',
  scopePrefix: (label: string): string => `対象: ${label}`,
  /** チャットが絞った範囲。rangeLabel は利用者の言い回しそのまま（@shared/ipc の ChatScopeDto）。 */
  scopeLabel: (rangeLabel: string, count: number): string => `${rangeLabel}の ${count} 件`,
  thinking: '考えています…',
  aborted: 'ここで中断しました。',
  send: '送信',
  stop: '停止',
  chatDisabled: 'チャットが無効です。設定画面で有効にしてください。',
  modelNotInstalled: '要約モデルが未取得です。設定画面で取得してください。',
  /** 出典の 1 行。日付・種別（要約／文字起こし）・一部だけなら断りを添える。 */
  citationMeta: (dateLabel: string, source: 'summary' | 'transcript', truncated: boolean): string =>
    `${dateLabel} ・${source === 'summary' ? ' 要約' : ' 文字起こし'}${truncated ? '（一部）' : ''}`,
  noAnswer: 'モデルから答えが返りませんでした。もう一度お試しください。',
  truncatedNotice: '答えが長すぎたため、ここで打ち切られました。期間や聞き方を絞ると最後まで出ます。',
  inlineSource: (label: string): string => `（${label}）`,
  inlineSourceMore: (label: string, more: number): string => `（${label} ほか${more}件）`
}

const en: typeof ja = {
  heading: 'Chat',
  lead: 'Answers are based on your recordings, transcripts, and summaries. Everything runs on this Mac.',
  newConversation: 'New Conversation',
  emptyHint: 'You can ask about a specific period or speaker.',
  examples: [
    'Summarize last week’s to-dos',
    'Summarize only what I said last week',
    'List this month’s decisions'
  ] as readonly string[],
  composerPlaceholder: 'Summarize last week’s to-dos',
  scopePrefix: (label: string): string => `Scope: ${label}`,
  scopeLabel: (rangeLabel: string, count: number): string =>
    `${rangeLabel} — ${count} ${count === 1 ? 'recording' : 'recordings'}`,
  thinking: 'Thinking…',
  aborted: 'Stopped here.',
  send: 'Send',
  stop: 'Stop',
  chatDisabled: 'Chat is disabled. Enable it in Settings.',
  modelNotInstalled: 'The summarization model hasn’t been downloaded. Download it in Settings.',
  citationMeta: (dateLabel: string, source: 'summary' | 'transcript', truncated: boolean): string =>
    `${dateLabel} · ${source === 'summary' ? 'Summary' : 'Transcript'}${truncated ? ' (partial)' : ''}`,
  noAnswer: 'No answer came back from the model. Please try again.',
  truncatedNotice:
    'The answer was cut off because it got too long. Narrow the period or the question to see the whole answer.',
  // CITATION_RUN は番号の前の空白ごと消して置き換えるので、日本語の「（」と違い
  // 英語では単語との間に空白を残す必要がある（ここで前置する）。
  inlineSource: (label: string): string => ` (${label})`,
  inlineSourceMore: (label: string, more: number): string => ` (${label} and ${more} more)`
}

export const chatText = localized({ ja, en })
