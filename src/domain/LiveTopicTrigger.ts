/**
 * 録音中の発言から「過去の会議を指している」箇所を見つけ、過去の録音を提示するかを決める（ADR-050）。
 *
 * 自動で出すのは決定的に決められるものだけにする。どの発言が過去を指すかも、期間の解釈も
 * LLM に任せない（ADR-032）。期間は planChatQuery（チャットと同じ解釈）で取り、
 * 当たり外れは画面のカード 1 枚に留める。会議中に何度も出ると邪魔になるので、頻度もここで絞る。
 *
 * 日本語の言い回しだけを読む。英語の会議では提示しない（ADR-043 の「残した判断」と同じ）。
 */

import { planChatQuery, MIN_TOPIC_CHARS } from './ChatQuery'
import type { DateRange } from './DateExpression'
import { startOfDay } from './DateExpression'

/**
 * 過去を指す語。「今日」「今週」は今の会議を含むので入れない（今の議題の話を過去として拾う）。
 * 「来週」「来月」は未来で、そもそも過去の録音が無い。
 */
const PAST_CUE = /先々週|先週|先月|一昨日|おととい|昨日|前回|先日|この前|こないだ|この間|以前|前に|去年|昨年/

/**
 * 過去の会議の話題を指す語。過去の語だけで拾うと「昨日は雨でしたね」のような雑談まで拾う。
 * 「の件」だけで拾わないのは、「リリースの件ですが」のように今の議題を出すときにも使うから。
 */
const REFERENCE = /の件|の話|について|話し|言って|言った|決ま|決め|出た|相談|打ち合わせ|会議|定例|ミーティング/

/** 話題語の終わり。ここより後ろ（「ですが」「どうなりました」）は話題ではない。 */
const TOPIC_END = /の件|の話|について|って/

/**
 * 「〜で話していた」「〜で出た」のような、話題を過去の会議に結びつける言い回し。
 * これより前は「どの会議か」で、後ろが話題。前を残すと「定例」が全ての定例に一致する。
 */
const RELATIVE_CLAUSE =
  /^.*?(?:話して(?:い)?た|話した|言って(?:い)?た|言った|出て(?:い)?た|出た|決まった|決めた|相談した|上がった)/

/** 話題語の先頭・末尾に残る助詞や記号。 */
const EDGE = /^[のでにとがはもを、,\s]+|[のでにとがはもを、,\s]+$/g

/** 長すぎる話題語は文の残りを抱えている。意味検索の問いとしては短い方が当たる。 */
const MAX_TOPIC_CHARS = 40

export interface PastReference {
  readonly topic: string
  readonly range?: DateRange
  readonly rangeLabel?: string
}

const SENTENCE = /[^。！？!?\n]+/g

export const detectPastReference = (text: string, now: Date): PastReference | undefined => {
  for (const sentence of text.match(SENTENCE) ?? []) {
    const cue = PAST_CUE.exec(sentence)
    if (!cue) continue
    const rest = sentence.slice(cue.index)
    if (!REFERENCE.test(rest.slice(cue[0].length))) continue

    const end = TOPIC_END.exec(rest)
    const clause = (end ? rest.slice(0, end.index) : (rest.split(/[、,]/)[0] ?? rest)).trim()
    const topic = clause.slice(cue[0].length).replace(RELATIVE_CLAUSE, '').replace(EDGE, '').trim()
    if (topic.length < MIN_TOPIC_CHARS || topic.length > MAX_TOPIC_CHARS) continue

    const plan = planChatQuery(clause, now)
    // 今日を含む期間は今の会議を指してしまう。期間で絞らず、話題だけで探す。
    const past = plan.range !== undefined && plan.range.toMs <= startOfDay(now).getTime()
    return past && plan.range
      ? { topic, range: plan.range, ...(plan.rangeLabel === undefined ? {} : { rangeLabel: plan.rangeLabel }) }
      : { topic }
  }
  return undefined
}

export interface TopicTriggerOptions {
  /** 提示はこれだけ空ける。会議の邪魔にならない頻度。 */
  readonly minSuggestionIntervalMs: number
  /** 検索はこれだけ空ける。同じ話を言い換えながら続けると、文ごとに検索が走る。 */
  readonly minSearchIntervalMs: number
}

export const DEFAULT_TOPIC_TRIGGER_OPTIONS: TopicTriggerOptions = {
  minSuggestionIntervalMs: 180_000,
  minSearchIntervalMs: 30_000
}

export interface SuggestionCandidate {
  readonly recordingId: string
  /** 文字起こしで当たったときの箇所。要約やメモで当たれば無い。 */
  readonly startMs?: number
}

export interface TopicTriggerState {
  readonly searchedTopics: readonly string[]
  readonly shown: readonly string[]
  readonly dismissedRecordings: readonly string[]
  readonly lastSearchAtMs?: number
  readonly lastSuggestionAtMs?: number
}

export const initialTopicTrigger = (): TopicTriggerState => ({
  searchedTopics: [],
  shown: [],
  dismissedRecordings: []
})

const topicKey = (topic: string): string => topic.replace(/\s+/g, '')
const candidateKey = (candidate: SuggestionCandidate): string => `${candidate.recordingId}@${candidate.startMs ?? '-'}`

export const shouldSearch = (
  state: TopicTriggerState,
  params: { topic: string; nowMs: number },
  options: TopicTriggerOptions = DEFAULT_TOPIC_TRIGGER_OPTIONS
): boolean => {
  if (state.searchedTopics.includes(topicKey(params.topic))) return false
  if (state.lastSearchAtMs !== undefined && params.nowMs - state.lastSearchAtMs < options.minSearchIntervalMs)
    return false
  return !(
    state.lastSuggestionAtMs !== undefined && params.nowMs - state.lastSuggestionAtMs < options.minSuggestionIntervalMs
  )
}

/** 検索したら、当たらなくても同じ話題語では探し直さない。 */
export const recordSearch = (
  state: TopicTriggerState,
  params: { topic: string; nowMs: number }
): TopicTriggerState => ({
  ...state,
  searchedTopics: [...state.searchedTopics, topicKey(params.topic)],
  lastSearchAtMs: params.nowMs
})

/** 検索の当たり（スコア順）から、まだ出していない最初の 1 件を選ぶ。 */
export const pickSuggestion = <C extends SuggestionCandidate>(
  state: TopicTriggerState,
  candidates: readonly C[]
): C | undefined =>
  candidates.find(
    (candidate) =>
      !state.shown.includes(candidateKey(candidate)) && !state.dismissedRecordings.includes(candidate.recordingId)
  )

/**
 * 提示したことを覚える。dismissed は利用者が × で閉じたとき — その録音は要らないと
 * 言われたので、別の箇所でも出さない。
 */
export const recordSuggestion = (
  state: TopicTriggerState,
  params: { candidate: SuggestionCandidate; nowMs: number; dismissed?: boolean }
): TopicTriggerState => ({
  ...state,
  shown: [...state.shown, candidateKey(params.candidate)],
  dismissedRecordings: params.dismissed
    ? [...state.dismissedRecordings, params.candidate.recordingId]
    : state.dismissedRecordings,
  lastSuggestionAtMs: params.nowMs
})
