import { parseDateExpression, type DateRange } from '@domain/DateExpression'
import { focusQuery } from '@domain/SemanticSearch'

/**
 * チャットの問い文を「どの録音の、誰の発言を見るか」という計画に変える純粋な計算。
 *
 * 絞り込みをモデルに任せず、ここで決める。決めた内容は利用者に提示できるので、
 * 外していれば言い直せる。モデルに任せると、外したことが出力から見えない。
 */

export type SpeakerScope = 'all' | 'self' | 'remote'

export interface ChatQueryPlan {
  readonly question: string
  readonly range?: DateRange
  readonly rangeLabel?: string
  readonly speakerScope: SpeakerScope
  /** 日付語・話者語・依頼の言い回しを除いた残り。意味検索に渡す。 */
  readonly topic: string
  /** 要約では答えられず、文字起こしが要るか。 */
  readonly needsTranscript: boolean
}

/** これより短い残りは話題として扱わない。助詞の削り残りで検索を濁らせないため。 */
export const MIN_TOPIC_CHARS = 2

interface Span {
  readonly start: number
  readonly end: number
}

const SELF_PRONOUN = '(?:自分|私|わたし|僕|ぼく)'
const REMOTE_PRONOUN = '(?:相手|先方|参加者|お客様|お客さま|クライアント|他の人)'
const UTTERANCE = '(?:発言|話|コメント|言葉)'
const ONLY = '(?:だけ|のみ)?'

/**
 * 話者の指定は「〜の発言」「〜が言った」の形でだけ拾う。
 *
 * 「私はA社の担当です」のような文脈で一人称が出ただけで自分の発言に絞ると、
 * 相手の発言が丸ごと消えた要約を、絞ったと気づかないまま読むことになる。
 */
const SPEAKER_RULES: readonly { readonly scope: SpeakerScope; readonly pattern: RegExp }[] = [
  {
    scope: 'self',
    pattern: new RegExp(`${SELF_PRONOUN}の${UTTERANCE}${ONLY}`, 'g')
  },
  {
    scope: 'self',
    pattern: new RegExp(`${SELF_PRONOUN}が(?:言った|話した|述べた|発言した)(?:こと)?${ONLY}`, 'g')
  },
  {
    scope: 'remote',
    pattern: new RegExp(`${REMOTE_PRONOUN}の${UTTERANCE}${ONLY}`, 'g')
  },
  {
    scope: 'remote',
    pattern: new RegExp(`${REMOTE_PRONOUN}が(?:言った|話した|述べた|発言した)(?:こと)?${ONLY}`, 'g')
  }
]

/** 要約は言い換えを含むので、言葉そのものを問われたら文字起こしに当たる。 */
const VERBATIM = /逐語|原文|そのまま|一言一句|何と言っ|どう言っ|何て言っ/

/**
 * チャット特有の依頼の言い回し。
 *
 * 意味検索の focusQuery が落とすのは「教えて」「探して」までで、
 * 「まとめて」「要約して」は残る。チャットではこちらの方がよく使われる。
 */
const CHAT_REQUEST_TAIL =
  /(?:を|が|は|について|に関して)?(?:まとめ|要約し|整理し|振り返っ|洗い出し|抽出し|列挙し|教え)(?:て|てくれ|てください|て下さい|てほしい|て欲しい)?[。．.！!？?\s]*$/

/** 「〜は？」「〜って何だっけ」のような問いの結び。 */
const QUESTION_TAIL = /(?:は|って|とは)?(?:何|なに|どう|どれ|いつ)?(?:だっけ|ですか|でしたか|かな)?[？?。．.！!\s]*$/

/** span を削った跡に残る助詞や記号。話題語の両端からだけ落とす。 */
const EDGE_NOISE = /^[\s、。，．,.・:：「」『』()（）のをはがでにとへもや]+|[\s、。，．,.・:：「」『』()（）のをはがでにとへもや]+$/g

const removeSpans = (text: string, spans: readonly Span[]): string => {
  if (spans.length === 0) return text

  const ordered = [...spans].sort((a, b) => a.start - b.start)
  let result = ''
  let cursor = 0
  for (const span of ordered) {
    if (span.start < cursor) continue
    result += `${text.slice(cursor, span.start)} `
    cursor = span.end
  }
  return result + text.slice(cursor)
}

const trimEdges = (text: string): string => text.replace(EDGE_NOISE, '').trim()

const findSpeaker = (
  question: string
): { scope: SpeakerScope; spans: Span[] } => {
  for (const rule of SPEAKER_RULES) {
    rule.pattern.lastIndex = 0
    const match = rule.pattern.exec(question)
    if (match) {
      return {
        scope: rule.scope,
        spans: [{ start: match.index, end: match.index + match[0].length }]
      }
    }
  }
  return { scope: 'all', spans: [] }
}

export const planChatQuery = (question: string, now: Date): ChatQueryPlan => {
  const date = parseDateExpression(question, now)
  const speaker = findSpeaker(question)

  const stripped = removeSpans(question, [...(date?.spans ?? []), ...speaker.spans])
  const withoutRequest = trimEdges(
    trimEdges(stripped.replace(/\s+/g, ' ').trim())
      .replace(CHAT_REQUEST_TAIL, '')
      .replace(QUESTION_TAIL, '')
  )
  // focusQuery は「〜をしたミーティング」まで落とす。意味検索に渡す形を揃えておく。
  const topic = withoutRequest.length === 0 ? '' : trimEdges(focusQuery(withoutRequest))

  return {
    question,
    ...(date === undefined ? {} : { range: date.range, rangeLabel: date.label }),
    speakerScope: speaker.scope,
    topic,
    needsTranscript: speaker.scope !== 'all' || VERBATIM.test(question)
  }
}

export const hasTopic = (plan: ChatQueryPlan): boolean => plan.topic.length >= MIN_TOPIC_CHARS
