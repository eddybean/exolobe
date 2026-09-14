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
  /** 生成の上限に達して書ききれなかったか。 */
  readonly truncated?: boolean
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
 *
 * ただし最終テキストが空なら、流れてきた本文を残す。モデルの戻り値が空でも
 * 断片は届いていることがあり、丸ごと置き換えると読めていた答えが消える。
 */
export const completeMessage = (
  messages: readonly ChatMessage[],
  done: ChatDoneDto
): ChatMessage[] =>
  messages.map((message) =>
    message.id === done.requestId
      ? {
          ...message,
          text: done.text.trim() === '' ? message.text : done.text,
          citations: done.citations,
          ...(done.scopeLabel === undefined ? {} : { scopeLabel: done.scopeLabel }),
          streaming: false,
          truncated: done.truncated,
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

/** 出典の日付。時刻までは出さない —— 項目ごとに添えるので短いほど読める。 */
const formatSourceDate = (iso: string): string =>
  new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric' }).format(new Date(iso))

/**
 * 本文中の出典番号の並び。
 *
 * チェックボックスの `[ ]` と紛れないよう数字だけを見る。続けて並んだものは
 * 1 つの塊として扱う —— 毎回の定例に出てくる項目は出典が会議の数だけ並び、
 * そのまま名前に開くと 1 行が読めなくなる。
 */
/**
 * モデルは `[1][2]` とも `[1, 2]` とも `[1], [2]` とも書く。いずれも 1 つの並びとして扱う。
 * 番号の後ろの区切り文字は、次が番号のときだけ飲み込む（本文の読点を消さない）。
 */
const BRACKET = String.raw`\[\d{1,2}(?:\s*,\s*\d{1,2})*\]`
const CITATION_RUN = new RegExp(`[ \\t]*${BRACKET}(?:\\s*[,、]?\\s*${BRACKET})*`, 'g')
/** 並びの中の番号。括弧・カンマ・空白しか混ざらないので、数字だけを拾えばよい。 */
const CITATION_NUMBER = /\d{1,2}/g

/** 名前を開いて出す上限。これを超えたら先頭だけ出して残りは件数で言う。 */
const MAX_INLINE_SOURCES = 2

/**
 * 答えの中の `[1]` を「（会議名 9月4日）」に置き換える。
 *
 * モデルに会議名と日付を書き写させると、長いタイトルで崩れたり取り違えたりする。
 * 番号だけ書かせて、名前はこちらで当てる —— 番号と出典の対応は文脈を組み立てた
 * 時点で確定しているので、推論を挟む余地が無い。
 */
export const withInlineSources = (
  text: string,
  citations: readonly ChatCitationDto[]
): string => {
  if (citations.length === 0) return text

  return text.replace(CITATION_RUN, (run) => {
    const found = [...run.matchAll(CITATION_NUMBER)].map(
      (match) => citations[Number.parseInt(match[0], 10) - 1]
    )
    // 対応する出典が無い番号は、モデルの書き間違い。消すと根拠が消えたように見える。
    if (found.length === 0 || found.some((citation) => citation === undefined)) return run

    const named = found.filter((c): c is ChatCitationDto => c !== undefined)
    const label = (c: ChatCitationDto): string => `${c.title} ${formatSourceDate(c.startedAt)}`

    if (named.length > MAX_INLINE_SOURCES) {
      const [first] = named
      return first === undefined ? run : `（${label(first)} ほか${named.length - 1}件）`
    }
    return named.map((c) => `（${label(c)}）`).join('')
  })
}

/**
 * 本文が無いまま終わった回答に添える断り。
 *
 * 何も描かないと、下に並ぶ出典の一覧だけが残って「それが答え」に見える。
 * 失敗と中断はそれぞれの表示があるので、ここでは扱わない。
 */
export const answerNotice = (message: ChatMessage): string | undefined => {
  if (message.role !== 'assistant') return undefined
  if (message.streaming || message.error !== undefined || message.aborted === true) return undefined

  if (message.text.trim() === '') {
    return 'モデルから答えが返りませんでした。もう一度お試しください。'
  }
  // 黙って尻切れにすると、利用者はそれが全部だと思う。
  if (message.truncated === true) {
    return '答えが長すぎたため、ここで打ち切られました。期間や聞き方を絞ると最後まで出ます。'
  }
  return undefined
}
