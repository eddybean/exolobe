import type {
  ClockPort,
  LiveAssistModelPort,
  LiveTranscriptionFailure,
  LiveTranscriptionPort,
  PastRecordingHit,
  PastRecordingSearchPort
} from '@application/ports'
import { AppError } from '@domain/errors'
import {
  actionsPrompt,
  fitTranscriptToBudget,
  formatLiveTranscript,
  headlinePrompt,
  LIVE_TRANSCRIPT_BUDGET_TOKENS,
  parseActionCandidates,
  parseHeadline,
  parseSummary,
  summaryPrompt,
  type ActionCandidate,
  type LiveHeadline,
  type LiveUtterance
} from '@domain/LiveAssistPrompt'
import type { CaptionEvent, CaptionTrack } from '@domain/LiveCaption'
import { headlineScheduleOptions, isHeadlineDue } from '@domain/LiveHeadlineSchedule'
import {
  detectPastReference,
  initialTopicTrigger,
  pickSuggestion,
  recordSearch,
  recordSuggestion,
  shouldSearch,
  type TopicTriggerState
} from '@domain/LiveTopicTrigger'
import type { MeetingLanguage } from '@domain/MeetingLanguage'

/**
 * 録音中のアシスト（ADR-050）。
 *
 * 自動で出すのは字幕・過去の録音のカード・見出しだけで、ここまでの要約と ToDo は
 * 利用者が押したときにだけ作る。どれも書き込まない — メモへの追加は画面が利用者の操作で行う。
 * 失敗はどれも録音に響かせない（例外にせず、出さないか状態で知らせる）。
 */

export type LiveAssistStatus =
  | { readonly state: 'off' }
  | { readonly state: 'starting' }
  | { readonly state: 'downloading' }
  | { readonly state: 'running' }
  | { readonly state: 'unavailable'; readonly reason: LiveTranscriptionFailure }

export interface LiveAssistFeatures {
  readonly captions: boolean
  readonly pastRecordings: boolean
  readonly headlines: boolean
}

export interface LiveSuggestion extends PastRecordingHit {
  /** 発言が期間を指していればその表記（「先週（11/16〜11/22）」）。何で絞ったかを画面に出す（ADR-032）。 */
  readonly rangeLabel?: string
}

export interface LiveAssistListener {
  caption(event: CaptionEvent): void
  status(status: LiveAssistStatus): void
  suggestion(suggestion: LiveSuggestion): void
  headline(headline: LiveHeadline): void
}

const LOCALES: Readonly<Record<MeetingLanguage, string>> = { ja: 'ja-JP', en: 'en-US' }

/** 見出しは今の話題に付けるので、直近 10 分だけを見せる。古い話題が混ざると見出しが鈍る。 */
const HEADLINE_WINDOW_MS = 10 * 60_000

/** 検索は上位だけ見る。期間と既出を除いても残る程度に多めに取る。 */
const SUGGESTION_SEARCH_LIMIT = 10

/** 字幕の認識器を動かし、確定した発言を録音の間だけ持つ（保存しない）。 */
export class RunLiveCaptions {
  private running = false
  private readonly utterances: LiveUtterance[] = []

  constructor(private readonly transcription: LiveTranscriptionPort) {}

  async start(params: {
    sampleRate: number
    language: MeetingLanguage
    onCaption: (event: CaptionEvent) => void
    onStatus: (status: LiveAssistStatus) => void
  }): Promise<void> {
    params.onStatus({ state: 'starting' })
    this.running = true
    try {
      await this.transcription.start({
        sampleRate: params.sampleRate,
        locale: LOCALES[params.language],
        onEvent: (event) => {
          if (!this.running) return
          switch (event.type) {
            case 'ready':
              params.onStatus({ state: 'running' })
              return
            case 'downloading':
              params.onStatus({ state: 'downloading' })
              return
            case 'failed':
              params.onStatus({ state: 'unavailable', reason: event.reason })
              return
            case 'caption':
              if (event.caption.kind === 'final' && event.caption.text.trim() !== '') {
                this.utterances.push({
                  track: event.caption.track,
                  text: event.caption.text.trim(),
                  startMs: event.caption.startMs
                })
              }
              params.onCaption(event.caption)
          }
        }
      })
    } catch {
      this.running = false
      params.onStatus({ state: 'unavailable', reason: 'crashed' })
    }
  }

  push(track: CaptionTrack, pcm: Uint8Array): void {
    if (this.running) this.transcription.push(track, pcm)
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false
    await this.transcription.stop()
  }

  /** ここまでに確定した発言。話し始めた時刻の順。 */
  transcript(): readonly LiveUtterance[] {
    return [...this.utterances].sort((a, b) => a.startMs - b.startMs)
  }
}

/** 過去の会議を指す発言から、意味検索で該当する録音の箇所を 1 件選ぶ。 */
export class SuggestPastRecording {
  private state: TopicTriggerState = initialTopicTrigger()

  constructor(private readonly search: PastRecordingSearchPort) {}

  async execute(params: {
    text: string
    now: Date
    nowMs: number
    excludeRecordingId: string
  }): Promise<LiveSuggestion | undefined> {
    const reference = detectPastReference(params.text, params.now)
    if (!reference || !shouldSearch(this.state, { topic: reference.topic, nowMs: params.nowMs })) return undefined

    // 待っている間に次の発言が来ても同じ話題で探し直さないよう、検索の前に覚える。
    this.state = recordSearch(this.state, { topic: reference.topic, nowMs: params.nowMs })
    let hits: readonly PastRecordingHit[]
    try {
      hits = await this.search.search(reference.topic, SUGGESTION_SEARCH_LIMIT)
    } catch {
      return undefined
    }

    const { range } = reference
    const inScope = hits.filter(
      (hit) =>
        hit.recordingId !== params.excludeRecordingId &&
        (range === undefined || (hit.startedAt.getTime() >= range.fromMs && hit.startedAt.getTime() < range.toMs))
    )
    const picked = pickSuggestion(this.state, inScope)
    if (!picked) return undefined

    this.state = recordSuggestion(this.state, { candidate: picked, nowMs: params.nowMs })
    return reference.rangeLabel === undefined ? { ...picked } : { ...picked, rangeLabel: reference.rangeLabel }
  }

  dismiss(params: { recordingId: string; nowMs: number }): void {
    this.state = recordSuggestion(this.state, {
      candidate: { recordingId: params.recordingId },
      nowMs: params.nowMs,
      dismissed: true
    })
  }
}

const requireModel = (model: LiveAssistModelPort | undefined): LiveAssistModelPort => {
  if (!model) throw new AppError({ code: 'appleIntelligenceUnavailable', availability: 'missing' })
  return model
}

const transcriptFor = (utterances: readonly LiveUtterance[], language: MeetingLanguage): string =>
  formatLiveTranscript(fitTranscriptToBudget(utterances, LIVE_TRANSCRIPT_BUDGET_TOKENS, language), language)

/** 今の話題の見出し（自動）と、ここまでの要約（押したとき）。 */
export class SummarizeLiveTopic {
  constructor(private readonly model: LiveAssistModelPort | undefined) {}

  /** 見出しは自動で出すので、失敗しても読めなくても何も出さない。 */
  async headline(utterances: readonly LiveUtterance[], language: MeetingLanguage): Promise<LiveHeadline | undefined> {
    if (!this.model || utterances.length === 0) return undefined
    try {
      return parseHeadline(await this.model.respond(headlinePrompt(transcriptFor(utterances, language), language)))
    } catch {
      return undefined
    }
  }

  /** 押したときだけ作る。使えない理由は利用者に返す。 */
  async summary(utterances: readonly LiveUtterance[], language: MeetingLanguage): Promise<readonly string[]> {
    const model = requireModel(this.model)
    if (utterances.length === 0) return []
    return parseSummary(await model.respond(summaryPrompt(transcriptFor(utterances, language), language))) ?? []
  }
}

/** ここまでの ToDo と決定事項の候補。書き込むのは利用者が「メモに追加」を押したときだけ（画面側）。 */
export class ExtractLiveActions {
  constructor(private readonly model: LiveAssistModelPort | undefined) {}

  async execute(utterances: readonly LiveUtterance[], language: MeetingLanguage): Promise<ActionCandidate[]> {
    const model = requireModel(this.model)
    if (utterances.length === 0) return []
    return parseActionCandidates(await model.respond(actionsPrompt(transcriptFor(utterances, language), language)))
  }
}

export interface LiveAssistSessionDeps {
  readonly transcription: LiveTranscriptionPort
  readonly clock: ClockPort
  /** Apple Intelligence が使えなければ無い。見出し・要約・ToDo を出さない。 */
  readonly model?: LiveAssistModelPort
  /** 意味検索が使えなければ無い。過去の録音を提示しない。 */
  readonly search?: PastRecordingSearchPort
}

/** 1 回の録音のあいだのアシスト。録音を始めるたびに作り直す。 */
export class LiveAssistSession {
  private readonly captions: RunLiveCaptions
  private readonly topic: SummarizeLiveTopic
  private readonly actions: ExtractLiveActions
  private readonly suggest: SuggestPastRecording | undefined
  private params:
    | {
        recordingId: string
        language: MeetingLanguage
        features: LiveAssistFeatures
        headlineIntervalMin: number
        listener: LiveAssistListener
        beganAtMs: number
      }
    | undefined
  private ended = false
  private lastHeadlineAtMs = 0
  private lastFinalAtMs: number | undefined
  private newChars = 0
  private headlineInFlight = false

  constructor(private readonly deps: LiveAssistSessionDeps) {
    this.captions = new RunLiveCaptions(deps.transcription)
    this.topic = new SummarizeLiveTopic(deps.model)
    this.actions = new ExtractLiveActions(deps.model)
    this.suggest = deps.search ? new SuggestPastRecording(deps.search) : undefined
  }

  private elapsedMs(): number {
    return this.deps.clock.now().getTime() - (this.params?.beganAtMs ?? 0)
  }

  async begin(params: {
    recordingId: string
    sampleRate: number
    language: MeetingLanguage
    features: LiveAssistFeatures
    headlineIntervalMin: number
    listener: LiveAssistListener
  }): Promise<void> {
    const { features, listener } = params
    this.params = { ...params, beganAtMs: this.deps.clock.now().getTime() }
    if (!features.captions && !features.pastRecordings && !features.headlines) {
      listener.status({ state: 'off' })
      return
    }

    await this.captions.start({
      sampleRate: params.sampleRate,
      language: params.language,
      onStatus: (status) => listener.status(status),
      onCaption: (event) => {
        if (features.captions) listener.caption(event)
        if (event.kind === 'final') this.onFinal(event)
      }
    })
  }

  private onFinal(event: CaptionEvent): void {
    const params = this.params
    if (!params) return
    this.lastFinalAtMs = this.elapsedMs()
    this.newChars += event.text.trim().length

    if (!params.features.pastRecordings || !this.suggest) return
    void this.suggest
      .execute({
        text: event.text,
        now: this.deps.clock.now(),
        nowMs: this.elapsedMs(),
        excludeRecordingId: params.recordingId
      })
      .then((suggestion) => {
        if (suggestion && !this.ended) params.listener.suggestion(suggestion)
      })
  }

  push(track: CaptionTrack, pcm: Uint8Array): void {
    this.captions.push(track, pcm)
  }

  /** 見出しを作る時期かを見る。main が数秒おきに呼ぶ。 */
  async tick(): Promise<void> {
    const params = this.params
    if (!params || this.ended || !params.features.headlines || !this.deps.model || this.headlineInFlight) return

    const nowMs = this.elapsedMs()
    const due = isHeadlineDue(
      {
        nowMs,
        lastHeadlineAtMs: this.lastHeadlineAtMs,
        newChars: this.newChars,
        ...(this.lastFinalAtMs === undefined ? {} : { lastFinalAtMs: this.lastFinalAtMs })
      },
      headlineScheduleOptions(params.headlineIntervalMin)
    )
    if (!due) return

    // 失敗しても同じ時期に何度も作り直さないよう、試みた時点で数え直す。
    this.lastHeadlineAtMs = nowMs
    this.newChars = 0
    this.headlineInFlight = true
    try {
      const transcript = this.captions.transcript()
      const latest = transcript.at(-1)?.startMs ?? 0
      const recent = transcript.filter((utterance) => utterance.startMs >= latest - HEADLINE_WINDOW_MS)
      const headline = await this.topic.headline(recent, params.language)
      if (headline && !this.ended) params.listener.headline(headline)
    } finally {
      this.headlineInFlight = false
    }
  }

  async summarize(): Promise<readonly string[]> {
    return this.topic.summary(this.captions.transcript(), this.params?.language ?? 'ja')
  }

  async extractActions(): Promise<ActionCandidate[]> {
    return this.actions.execute(this.captions.transcript(), this.params?.language ?? 'ja')
  }

  dismissSuggestion(recordingId: string): void {
    this.suggest?.dismiss({ recordingId, nowMs: this.elapsedMs() })
  }

  async end(): Promise<void> {
    if (this.ended) return
    this.ended = true
    await this.captions.stop()
    this.params?.listener.status({ state: 'off' })
  }
}
