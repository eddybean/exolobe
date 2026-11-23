import type { PastRecordingSearchPort } from '@application/ports'
import type { LiveAssistFeatures, LiveAssistListener, LiveAssistSession } from '@application/usecases/live-assist'
import type { AppleIntelligenceStatus } from '@domain/AppleIntelligence'
import type { ActionCandidate } from '@domain/LiveAssistPrompt'
import type { CaptionTrack } from '@domain/LiveCaption'
import { meetingLanguageOf, type MeetingLanguage } from '@domain/MeetingLanguage'
import type { Settings } from '@domain/Settings'

const semanticSearchReady = (settings: Settings): boolean => settings.search.enabled && settings.search.modelPath !== ''

/** テストで差し替えられるよう、セッションの公開面だけを取り出す。 */
export type LiveAssistSessionLike = Pick<
  LiveAssistSession,
  'begin' | 'push' | 'tick' | 'summarize' | 'extractActions' | 'dismissSuggestion' | 'end'
>

export interface LiveAssistControllerDeps {
  readonly settings: { load(): Promise<Settings> }
  readonly appleIntelligence: () => Promise<AppleIntelligenceStatus>
  /** model: Apple Intelligence を使うか。search: 過去の録音を探す口（使わなければ undefined）。 */
  readonly createSession: (params: {
    model: boolean
    search: PastRecordingSearchPort | undefined
  }) => LiveAssistSessionLike
  readonly search: PastRecordingSearchPort
  /** 意味検索が使えるか。既定は「有効でモデルを取得済み」。開発用の台本（OMR_LIVE_ASSIST_FAKE）だけが差し替える。 */
  readonly searchAvailable?: (settings: Settings) => boolean
  readonly listener: LiveAssistListener
  readonly uiLanguage: MeetingLanguage
  readonly platform: NodeJS.Platform
  /** 見出しの時期を確かめる間隔。 */
  readonly tickIntervalMs?: number
  /** 止めるのを待つ上限。停止の後にはパイプラインが控えている。 */
  readonly endTimeoutMs?: number
}

/**
 * 録音 1 回ぶんの録音中のアシスト（ADR-050）を、録音の開始・停止に合わせて起こして止める。
 *
 * 録音の側からは「始める」「止める」「PCM を渡す」しか見えない。どれも例外にせず、録音を止めない。
 * electron に触れないので、録音の止まり方の組み合わせ（始めている途中で止められた・止まらない）を
 * ここで確かめられる。
 */
export class LiveAssistController {
  private session: LiveAssistSessionLike | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  /** begin のたびに増やす。待っている間に end や次の begin が来たら、古い begin は手を引く。 */
  private generation = 0

  constructor(private readonly deps: LiveAssistControllerDeps) {}

  async begin(params: { recordingId: string }): Promise<void> {
    // 待つより先に番号を取る。前のセッションを止めている間に end が来ても、この begin を取り消せる。
    const generation = ++this.generation
    await this.release()
    if (generation !== this.generation || this.deps.platform !== 'darwin') return

    try {
      const settings = await this.deps.settings.load()
      const { liveAssist } = settings
      if (!liveAssist.enabled) return

      const searchAvailable = (this.deps.searchAvailable ?? semanticSearchReady)(settings)
      // 見出しを切っていても、ここまでの要約と ToDo のために可否は聞く。
      const appleAvailable = (await this.deps.appleIntelligence()).availability === 'available'
      if (generation !== this.generation) return

      const features: LiveAssistFeatures = {
        captions: liveAssist.captions,
        pastRecordings: liveAssist.pastRecordings && searchAvailable,
        headlines: liveAssist.headlines && appleAvailable,
        onDemand: appleAvailable
      }
      const session = this.deps.createSession({
        model: appleAvailable,
        search: features.pastRecordings ? this.deps.search : undefined
      })
      this.session = session

      await session.begin({
        recordingId: params.recordingId,
        // 録音と同じ設定から読む。呼ぶ側で読んでから渡すと、読む間に止められたときに取り消せない。
        sampleRate: settings.audio.sampleRate,
        language: meetingLanguageOf(settings.transcription.language, this.deps.uiLanguage),
        features,
        headlineIntervalMin: liveAssist.headlineIntervalMin,
        listener: this.deps.listener
      })
      // begin の間に止められたなら、end がもう session を止めている。
      if (generation !== this.generation) return
      this.timer = setInterval(() => {
        void session.tick().catch(() => {})
      }, this.deps.tickIntervalMs ?? 5_000)
    } catch {
      // 設定が読めない・Apple Intelligence に聞けないなど。録音は続ける。
    }
  }

  push(track: CaptionTrack, pcm: Uint8Array): void {
    this.session?.push(track, pcm)
  }

  async end(): Promise<void> {
    this.generation += 1
    await this.release()
  }

  private async release(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    const session = this.session
    this.session = undefined
    if (!session) return

    let timeout: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      session.end().catch(() => {}),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, this.deps.endTimeoutMs ?? 3_000)
      })
    ])
    if (timeout) clearTimeout(timeout)
  }

  async summarize(): Promise<readonly string[]> {
    return this.session ? this.session.summarize() : []
  }

  async extractActions(): Promise<ActionCandidate[]> {
    return this.session ? this.session.extractActions() : []
  }

  dismissSuggestion(recordingId: string): void {
    this.session?.dismissSuggestion(recordingId)
  }
}
