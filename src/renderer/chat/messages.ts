import type { ChatCitationDto, ChatDoneDto, ChatTurnDto } from '@shared/ipc'

/**
 * チャットの表示状態を扱う純粋な計算。
 *
 * 描画と IPC の購読はフックに任せ、状態の遷移だけをここに閉じてテストする。
 */

export interface ChatMessage {
  /** 回答は依頼 ID と同じ。届いた断片をどのメッセージに足すかをこれで決める。 */
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly citations?: readonly ChatCitationDto[]
  readonly scopeLabel?: string
  readonly streaming: boolean
  readonly aborted?: boolean
  readonly error?: string
}

/**
 * モデルに渡す履歴の上限（3 往復）。
 *
 * 問いのたびに文脈（要約の本文）を作り直して載せるので、履歴まで長く持つと
 * 32K のコンテキストがすぐ埋まる。会話の流れを保つにはこのくらいで足りる。
 */
export const MAX_HISTORY_TURNS = 6

/** 質問と、これから書かれる空の回答を並べて置く。 */
export const startTurn = (
  messages: readonly ChatMessage[],
  requestId: string,
  question: string
): ChatMessage[] => [
  ...messages,
  { id: `${requestId}:q`, role: 'user', text: question, streaming: false },
  // 空の回答を先に置くことで、「考え中」の表示が別の仕組みにならずに済む。
  { id: requestId, role: 'assistant', text: '', streaming: true }
]

export const appendChunk = (
  messages: readonly ChatMessage[],
  requestId: string,
  text: string
): ChatMessage[] =>
  messages.map((message) =>
    message.id === requestId ? { ...message, text: message.text + text } : message
  )

/**
 * 生成の終わりを反映する。
 *
 * 断片の積み上げではなく最終テキストで丸ごと置き換える。取りこぼしや
 * 中断時のズレをここで一掃するため。
 */
export const completeMessage = (
  messages: readonly ChatMessage[],
  done: ChatDoneDto
): ChatMessage[] =>
  messages.map((message) =>
    message.id === done.requestId
      ? {
          ...message,
          text: done.text,
          citations: done.citations,
          ...(done.scopeLabel === undefined ? {} : { scopeLabel: done.scopeLabel }),
          streaming: false,
          aborted: done.aborted,
          ...(done.error === undefined ? {} : { error: done.error })
        }
      : message
  )

/**
 * モデルに渡す履歴を作る。
 *
 * 書きかけと失敗は除く。中断した回答は残す — 利用者はそこまでを読んでおり、
 * 「さっきの続き」と言われたときに噛み合わなくなる。
 */
export const toHistory = (messages: readonly ChatMessage[]): ChatTurnDto[] =>
  messages
    .filter((message) => !message.streaming && message.error === undefined && message.text !== '')
    .map((message) => ({ role: message.role, text: message.text }))
    .slice(-MAX_HISTORY_TURNS)
