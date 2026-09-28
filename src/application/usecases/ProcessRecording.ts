import type {
  AudioEncoderPort,
  AudioMixerPort,
  DiarizationPort,
  ProgressReporterPort,
  RecordingArtifactPort,
  RecordingRepositoryPort,
  RecordingSource,
  SettingsRepositoryPort,
  SpeakerEmbeddingPort,
  SummarizationPort,
  SystemResourcePort,
  TranscriptionPort,
  VoiceprintRepositoryPort
} from '@application/ports'
import {
  PIPELINE_STEPS,
  failStep,
  overallStatus,
  startStep,
  succeedStep,
  tooShortRecording,
  type PipelineStep,
  type Recording,
  type RecordingStatus,
  type StepStates
} from '@domain/Recording'
import { diarizationTarget, mixInputs, transcriptionTargets } from '@domain/RecordingSource'
import { PipelineStepError, RecordingNotFoundError, toMessage } from '@domain/errors'
import {
  estimateSummarizationBytes,
  estimateTranscriptionBytes,
  insufficientMemory,
  type MemoryDemand
} from '@domain/MemoryGuard'
import { findAsset } from '@domain/ModelCatalog'
import type { Settings } from '@domain/Settings'
import {
  REMOTE_SPEAKER_ID,
  SELF_SPEAKER_ID,
  defaultRemoteLabel,
  isRemoteSpeakerId,
  remoteSpeakerId,
  type Speaker
} from '@domain/Speaker'
import { applyDiarization, mergeTracks, toMarkdown } from '@domain/Transcript'
import { summaryNotes } from '@domain/MeetingNotes'
import type { SpeakerTurn, TranscriptSegment } from '@domain/TranscriptSegment'
import { matchVoiceprints, type SpeakerVector } from '@domain/Voiceprint'

export interface ProcessRecordingDeps {
  readonly settings: SettingsRepositoryPort
  readonly repository: RecordingRepositoryPort
  readonly artifacts: RecordingArtifactPort
  readonly mixer: AudioMixerPort
  readonly transcriber: TranscriptionPort
  readonly diarizer: DiarizationPort
  readonly embedder: SpeakerEmbeddingPort
  readonly voiceprints: VoiceprintRepositoryPort
  readonly summarizer: SummarizationPort
  readonly encoder: AudioEncoderPort
  readonly progress: ProgressReporterPort
  readonly system: SystemResourcePort
}

/** 各ステップが必要とする先行ステップ。先行が失敗したステップは実行せずスキップする。 */
const STEP_DEPENDENCIES: Readonly<Record<PipelineStep, readonly PipelineStep[]>> = {
  mix: [],
  transcribe: [],
  diarize: ['transcribe'],
  summarize: ['transcribe'],
  encode: ['mix']
}

/**
 * 中間 WAV を入力に取るステップ。ここが全て done なら WAV はもう誰も読まない。
 *
 * 要約が入っていないのは、やり直しに必要なのが transcript.json だけだから。
 * 要約モデルを入れていない機体では要約は永久に失敗したままで、全ステップ完了を
 * 待つと数百 MB の WAV が消える見込みなく残り続ける（ADR-010 の「失敗しても
 * 価値の高い成果物は守る」を、残骸を残さない側にも適用する）。
 */
const INTERMEDIATE_CONSUMERS: readonly PipelineStep[] = ['mix', 'transcribe', 'diarize', 'encode']

/**
 * 素材のトラック（tracks.json と WAV）を読むステップ。
 *
 * 要約とエンコードは成果物（transcript.json / mix.wav）しか読まないので含めない。
 * 要約だけが失敗した録音は中間ファイルを片付け済みで、トラックを前提にすると
 * 要約のリトライが「録音データが見つかりません」で必ず断られる。
 */
const TRACK_CONSUMERS: readonly PipelineStep[] = ['mix', 'transcribe', 'diarize']

const intermediatesDisposable = (steps: StepStates): boolean =>
  INTERMEDIATE_CONSUMERS.every((step) => steps[step].status === 'done')

const STEP_LABELS: Readonly<Record<PipelineStep, string>> = {
  mix: 'ミックス',
  transcribe: '文字起こし',
  diarize: '話者識別',
  summarize: '要約',
  encode: 'エンコード'
}

interface StepContext {
  readonly recording: Recording
  readonly settings: Settings
  /** トラックを読むステップを含まない実行では undefined（片付け済みでも動けるように）。 */
  readonly tracks: RecordingSource | undefined
}

/**
 * 録音停止後のパイプラインを実行する。
 *
 * 設計上の要点:
 * - ステップは互いに疎で、成果物（ファイル）を介してのみつながる。よって
 *   `only` を指定した個別リトライが自然に成立する。
 * - 1 ステップの失敗は依存するステップだけを止め、独立したステップは実行する。
 *   要約に失敗しても音声とエンコードは残るため、価値の高い成果物を守れる。
 */
export class ProcessRecording {
  constructor(private readonly deps: ProcessRecordingDeps) {}

  async execute(params: {
    recordingId: string
    only?: readonly PipelineStep[]
  }): Promise<Recording> {
    const recording = await this.deps.repository.find(params.recordingId)
    if (!recording) {
      throw new RecordingNotFoundError(params.recordingId)
    }

    // トラックを読むより前に断つ。中間ファイルは下で捨てるため、後から個別リトライ
    // されたときに「録音データが見つかりません」ではなく本当の理由を返せる。
    const tooShort = tooShortRecording(recording.durationMs)
    if (tooShort) {
      return this.abort(recording, tooShort)
    }

    const targets = params.only ?? PIPELINE_STEPS
    const tracks = targets.some((step) => TRACK_CONSUMERS.includes(step))
      ? await this.requireTracks(recording)
      : undefined

    const settings = await this.deps.settings.load()
    const context: StepContext = { recording, settings, tracks }

    let steps = recording.steps
    for (const step of PIPELINE_STEPS) {
      if (!targets.includes(step)) continue
      steps = await this.runStep(step, steps, context)
    }

    const processed = await this.saveSteps(recording, steps, overallStatus(steps))

    // 中間 WAV はリトライで再利用するため、それを読むステップが揃ってから消す。
    if (intermediatesDisposable(processed.steps)) {
      await this.deps.artifacts.cleanupIntermediates(processed)
    }

    return processed
  }

  /**
   * 1 ステップも実行せずにパイプラインを畳む。
   *
   * 全ステップを同じ理由で失敗にするのは、先頭だけ落として残りを pending に
   * 残すと「まだこれから動く」と読めてしまうため。中間 WAV は再実行しても
   * 同じ理由で断られる＝二度と使わないので、ここで捨てる。
   */
  private async abort(recording: Recording, reason: string): Promise<Recording> {
    let steps = recording.steps
    for (const step of PIPELINE_STEPS) {
      this.deps.progress.report({
        recordingId: recording.id,
        step,
        status: 'failed',
        error: reason
      })
      steps = failStep(steps, step, reason)
    }

    const aborted = await this.saveSteps(recording, steps, overallStatus(steps))
    await this.deps.artifacts.cleanupIntermediates(aborted)

    return aborted
  }

  private async runStep(
    step: PipelineStep,
    steps: StepStates,
    context: StepContext
  ): Promise<StepStates> {
    const blocker = STEP_DEPENDENCIES[step].find((dep) => steps[dep].status === 'failed')
    if (blocker) {
      return failStep(
        steps,
        step,
        `前のステップ（${STEP_LABELS[blocker]}）が失敗したため実行しませんでした。`
      )
    }

    const { recording } = context

    // モデルを読み込む前に断ることで、失敗を扱えるエラーにし OS を巻き込まない。
    const shortage = await this.checkMemory(step, context)
    if (shortage) {
      this.deps.progress.report({
        recordingId: recording.id,
        step,
        status: 'failed',
        error: shortage
      })
      return failStep(steps, step, shortage)
    }

    // 途中でアプリが落ちても「実行中で止まった」ことが分かるよう、開始時点で保存する。
    // 知らせるのは保存の後。知らせを受けた画面はすぐ読み直すので、先に知らせると
    // 前回の失敗を読んで出し直し、完了まで読み直す合図が来ないまま失敗と出続ける。
    const running = startStep(steps, step)
    await this.saveSteps(recording, running, 'processing')

    this.deps.progress.report({ recordingId: recording.id, step, status: 'running' })

    try {
      await this.executeStep(step, context)
      this.deps.progress.report({ recordingId: recording.id, step, status: 'done' })
      return succeedStep(running, step)
    } catch (error: unknown) {
      const message = toMessage(error)
      this.deps.progress.report({ recordingId: recording.id, step, status: 'failed', error: message })
      return failStep(running, step, message)
    }
  }

  /**
   * 重いステップの所要メモリを見積もり、空きが足りなければ理由を返す。
   *
   * 対象は数 GB のモデルを載せる文字起こしと要約だけ。ミックスやエンコードは
   * ストリーム処理で、判定する意味がない。
   */
  private async checkMemory(
    step: PipelineStep,
    { settings }: StepContext
  ): Promise<string | undefined> {
    if (settings.memoryProtection === 'off') return undefined

    const demand = await this.demandOf(step, settings)
    if (!demand) return undefined

    return insufficientMemory({
      snapshot: await this.deps.system.memory(),
      demand,
      protection: settings.memoryProtection
    })
  }

  private async demandOf(
    step: PipelineStep,
    settings: Settings
  ): Promise<MemoryDemand | undefined> {
    switch (step) {
      case 'transcribe': {
        const modelFileBytes = await this.modelBytes(
          settings.transcription.modelPath,
          'transcription-model'
        )
        if (modelFileBytes === undefined) return undefined
        return {
          bytes: estimateTranscriptionBytes({ modelFileBytes }),
          label: STEP_LABELS.transcribe
        }
      }
      case 'summarize': {
        const modelFileBytes = await this.modelBytes(
          settings.summarization.modelPath,
          'summarization-model'
        )
        if (modelFileBytes === undefined) return undefined
        return {
          bytes: estimateSummarizationBytes({
            modelFileBytes,
            contextSize: settings.summarization.contextSize
          }),
          label: STEP_LABELS.summarize
        }
      }
      default:
        return undefined
    }
  }

  /**
   * モデルの大きさ。実ファイルを優先し、読めなければカタログの既定値で代用する。
   * どちらも得られない場合は判定を諦める（見積もれないことを理由に止めない）。
   */
  private async modelBytes(path: string, assetId: string): Promise<number | undefined> {
    if (!path) return undefined
    return (await this.deps.system.fileSize(path)) ?? findAsset(assetId)?.bytes
  }

  /**
   * ステップの状態だけを保存する。
   *
   * パイプラインは数分走るため、その間に利用者はフォルダ移動やリネームをする。
   * 開始時に読んだ録音をそのまま書き戻すとその編集を巻き戻してしまうので、
   * 毎回最新を読み直し、このユースケースが持ち主である steps と status だけを重ねる。
   */
  private async saveSteps(
    snapshot: Recording,
    steps: StepStates,
    status: RecordingStatus
  ): Promise<Recording> {
    const latest = (await this.deps.repository.find(snapshot.id)) ?? snapshot
    const merged: Recording = { ...latest, steps, status }
    await this.deps.repository.save(merged)
    return merged
  }

  private async executeStep(step: PipelineStep, context: StepContext): Promise<void> {
    switch (step) {
      case 'mix':
        return this.mix(context)
      case 'transcribe':
        return this.transcribe(context)
      case 'diarize':
        return this.diarize(context)
      case 'summarize':
        return this.summarize(context)
      case 'encode':
        return this.encode(context)
    }
  }

  /** 素材のトラックを時刻整列して 1 本の WAV にまとめる。単一ソースなら 1 本のまま通る。 */
  private async mix({ recording, tracks }: StepContext): Promise<void> {
    await this.deps.mixer.mix({
      tracks: mixInputs(await this.requireTracks(recording, tracks)),
      outputPath: this.mixPath(recording)
    })
  }

  /**
   * 素材ごとに文字起こしし、話者 ID を付けて 1 本にまとめる。
   * どの WAV を誰として起こすかは transcriptionTargets が決める。
   */
  private async transcribe({ recording, settings, tracks }: StepContext): Promise<void> {
    const { language } = settings.transcription

    // 直列に回す。whisper を 2 本同時に走らせてもメモリを食うだけで速くならない。
    const targets = transcriptionTargets(await this.requireTracks(recording, tracks))
    const tracked: TranscriptSegment[][] = []
    for (const [index, target] of targets.entries()) {
      tracked.push(
        await this.deps.transcriber.transcribe({
          wavPath: target.wavPath,
          language,
          speakerId: target.speakerId,
          // 利用者が知りたいのはステップ全体の進み具合なので、トラック内の割合を
          // 全体へ換算する。トラックの長さはほぼ揃う（同じ会議の 2 系統）ので等分でよい。
          onProgress: (fraction) =>
            this.deps.progress.report({
              recordingId: recording.id,
              step: 'transcribe',
              status: 'running',
              fraction: (index + fraction) / targets.length
            })
        })
      )
    }

    const previous = await this.deps.artifacts.readTranscript(recording)
    const segments = mergeTracks(tracked)
    await this.deps.artifacts.writeTranscript(recording, {
      segments,
      speakers: buildSpeakers(segments, previous?.speakers)
    })
  }

  /** 相手側を話者クラスタに分割し、文字起こしを上書きする。 */
  private async diarize({ recording, settings, tracks }: StepContext): Promise<void> {
    if (!settings.diarization.enabled) return

    const existing = await this.requireTranscript(recording)
    const wavPath = diarizationTarget(await this.requireTracks(recording, tracks))
    const turns = await this.deps.diarizer.diarize({
      wavPath,
      maxSpeakers: settings.diarization.maxSpeakers
    })

    const segments = applyDiarization(existing.segments, turns)
    const known = await this.recallKnownSpeakers({ recording, settings, wavPath, turns })

    await this.deps.artifacts.writeTranscript(recording, {
      segments,
      speakers: buildSpeakers(segments, existing.speakers, known)
    })
  }

  /**
   * 今回の話者の声紋を録音に残し、声紋帳から名前を引き当てる。
   *
   * 失敗しても話者識別そのものは通す。名前の自動適用は「付け直す手間を省く」
   * だけの働きで、これが動かなくても話者の分離という本体は完成している。
   * 埋め込みモデルが壊れているときに、得られた分割まで捨てるのは割に合わない。
   * 利用者から見れば従来どおり「参加者A」が並ぶだけで、手で付け直せる。
   */
  private async recallKnownSpeakers(params: {
    recording: Recording
    settings: Settings
    wavPath: string
    turns: readonly SpeakerTurn[]
  }): Promise<ReadonlyMap<string, string>> {
    if (params.turns.length === 0) return new Map()
    const modelKey = this.deps.embedder.modelKey

    try {
      // 抽出より先に前回ぶんを捨てる。クラスタ番号は実行のたびに振り直されるので、
      // 抽出に失敗したまま古い voices.json が残ると、次に名前を付けたときに
      // 別人のベクトルをその名前で覚える。声紋帳は作り直せない。
      await this.deps.artifacts.writeVoices(params.recording, { modelKey, speakers: [] })

      const embedded = await this.deps.embedder.embedSpeakers({
        wavPath: params.wavPath,
        turns: params.turns
      })
      if (embedded.length === 0) return new Map()

      const vectors: SpeakerVector[] = embedded.map(({ speaker, vector }) => ({
        speakerId: remoteSpeakerId(speaker),
        vector
      }))

      await this.deps.artifacts.writeVoices(params.recording, { modelKey, speakers: vectors })

      return matchVoiceprints(vectors, await this.deps.voiceprints.list(), {
        threshold: params.settings.diarization.voiceprintThreshold,
        modelKey
      })
    } catch {
      return new Map()
    }
  }

  private async summarize({ recording, settings }: StepContext): Promise<void> {
    const { segments, speakers } = await this.requireTranscript(recording)
    // メモは録音後にも書き足せる。再要約でも毎回読み直す（ADR-042）。
    const notes = summaryNotes({
      note: await this.deps.artifacts.readNote(recording),
      marks: await this.deps.artifacts.readBookmarks(recording),
      segments,
      speakers
    })
    const summary = await this.deps.summarizer.summarize({
      transcript: toMarkdown(segments, speakers),
      notes,
      promptTemplate: settings.summarization.promptTemplate
    })

    await this.deps.artifacts.writeSummary(recording, summary)
  }

  private async encode({ recording, settings }: StepContext): Promise<void> {
    await this.deps.encoder.encode({
      inputPath: this.mixPath(recording),
      outputPath: await this.deps.artifacts.audioPath(recording),
      codec: settings.audio.codec,
      bitrateKbps: settings.audio.bitrateKbps
    })
  }

  private mixPath(recording: Recording): string {
    return `${this.deps.artifacts.workDir(recording)}/mix.wav`
  }

  /** 読み込み済みならそれを使い、無ければ読む。どちらでも無ければ断る。 */
  private async requireTracks(
    recording: Recording,
    loaded?: RecordingSource
  ): Promise<RecordingSource> {
    const tracks = loaded ?? (await this.deps.artifacts.readTracks(recording))
    if (!tracks) {
      throw new PipelineStepError('録音データが見つかりません。')
    }
    return tracks
  }

  private async requireTranscript(
    recording: Recording
  ): Promise<{ segments: TranscriptSegment[]; speakers: Speaker[] }> {
    const transcript = await this.deps.artifacts.readTranscript(recording)
    if (!transcript) {
      throw new PipelineStepError('文字起こしがまだありません。先に文字起こしを実行してください。')
    }
    return transcript
  }
}

/**
 * セグメントに登場する話者 ID から表示用の話者一覧を組み立てる。
 * 相手側のクラスタは登場順に「参加者A」「参加者B」… と採番する。
 *
 * 名前の優先順位は、利用者が付けた名前 → 声紋帳から引き当てた名前 → 既定の採番。
 * 話者 ID が同じなら利用者が付けた名前を引き継ぐ。文字起こしや話者識別を後から
 * 再実行しただけで「田中さん」が「参加者A」に戻るのは、名前を付けた手間を
 * 黙って捨てることになる。
 *
 * 引き当てた名前を利用者の名前より優先しないのは、推定で訂正を押し戻さないため。
 * 「田中さん」を「佐藤さん」に直した録音で話者識別をやり直したとき、声紋の一致を
 * 優先すると直した意味が無くなる。既に付いている名前が既定の採番と同じ場合だけは
 * 「利用者が付けたものではない」と見なし、引き当てに譲る。
 */
const buildSpeakers = (
  segments: readonly TranscriptSegment[],
  existing: readonly Speaker[] = [],
  known: ReadonlyMap<string, string> = new Map()
): Speaker[] => {
  const named = new Map(existing.map((speaker) => [speaker.id, speaker.label]))
  const speakers: Speaker[] = []
  const seen = new Set<string>()
  let remoteIndex = 0

  if (segments.some((segment) => segment.speakerId === SELF_SPEAKER_ID)) {
    speakers.push({
      id: SELF_SPEAKER_ID,
      kind: 'self',
      label: named.get(SELF_SPEAKER_ID) ?? '自分'
    })
    seen.add(SELF_SPEAKER_ID)
  }

  for (const segment of segments) {
    if (seen.has(segment.speakerId)) continue
    seen.add(segment.speakerId)

    if (isRemoteSpeakerId(segment.speakerId)) {
      const fallback =
        segment.speakerId === REMOTE_SPEAKER_ID ? '参加者' : defaultRemoteLabel(remoteIndex)
      if (segment.speakerId !== REMOTE_SPEAKER_ID) remoteIndex += 1

      // 既に付いている名前が既定の採番そのものなら、利用者が付けたものではない。
      // そこだけ声紋の引き当てに譲る（声紋帳が育った後で話者識別をやり直せば、
      // 過去の録音にも名前が入る）。
      const given = named.get(segment.speakerId)
      speakers.push({
        id: segment.speakerId,
        kind: 'remote',
        label:
          given !== undefined && given !== fallback
            ? given
            : (known.get(segment.speakerId) ?? fallback)
      })
    } else {
      speakers.push({
        id: segment.speakerId,
        kind: 'self',
        label: named.get(segment.speakerId) ?? segment.speakerId
      })
    }
  }

  return speakers
}
