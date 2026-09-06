import type {
  AudioEncoderPort,
  AudioMixerPort,
  CapturedTracks,
  DiarizationPort,
  ProgressReporterPort,
  RecordingArtifactPort,
  RecordingRepositoryPort,
  SettingsRepositoryPort,
  SummarizationPort,
  TranscriptionPort
} from '@application/ports'
import {
  PIPELINE_STEPS,
  failStep,
  overallStatus,
  startStep,
  succeedStep,
  type PipelineStep,
  type Recording,
  type StepStates
} from '@domain/Recording'
import { PipelineStepError, RecordingNotFoundError, toMessage } from '@domain/errors'
import type { Settings } from '@domain/Settings'
import {
  REMOTE_SPEAKER_ID,
  SELF_SPEAKER_ID,
  defaultRemoteLabel,
  isRemoteSpeakerId,
  type Speaker
} from '@domain/Speaker'
import { applyDiarization, mergeTracks, toMarkdown } from '@domain/Transcript'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

export interface ProcessRecordingDeps {
  readonly settings: SettingsRepositoryPort
  readonly repository: RecordingRepositoryPort
  readonly artifacts: RecordingArtifactPort
  readonly mixer: AudioMixerPort
  readonly transcriber: TranscriptionPort
  readonly diarizer: DiarizationPort
  readonly summarizer: SummarizationPort
  readonly encoder: AudioEncoderPort
  readonly progress: ProgressReporterPort
}

/** 各ステップが必要とする先行ステップ。先行が失敗したステップは実行せずスキップする。 */
const STEP_DEPENDENCIES: Readonly<Record<PipelineStep, readonly PipelineStep[]>> = {
  mix: [],
  transcribe: [],
  diarize: ['transcribe'],
  summarize: ['transcribe'],
  encode: ['mix']
}

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
  readonly tracks: CapturedTracks
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

    const tracks = await this.deps.artifacts.readTracks(recording)
    if (!tracks) {
      throw new PipelineStepError('録音データが見つかりません。')
    }

    const settings = await this.deps.settings.load()
    const context: StepContext = { recording, settings, tracks }
    const targets = params.only ?? PIPELINE_STEPS

    let steps = recording.steps
    for (const step of PIPELINE_STEPS) {
      if (!targets.includes(step)) continue
      steps = await this.runStep(step, steps, context)
    }

    const processed: Recording = { ...recording, steps, status: overallStatus(steps) }
    await this.deps.repository.save(processed)

    // 中間 WAV はリトライで再利用するため、全ステップが揃ってから消す。
    if (processed.status === 'ready') {
      await this.deps.artifacts.cleanupIntermediates(processed)
    }

    return processed
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
    this.deps.progress.report({ recordingId: recording.id, step, status: 'running' })

    // 途中でアプリが落ちても「実行中で止まった」ことが分かるよう、開始時点で保存する。
    const running = startStep(steps, step)
    await this.deps.repository.save({ ...recording, steps: running, status: 'processing' })

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

  /** システム音声を基準に、マイクをオフセット分ずらして 1 本の WAV にまとめる。 */
  private async mix({ recording, tracks }: StepContext): Promise<void> {
    await this.deps.mixer.mix({
      tracks: [
        { path: tracks.systemWavPath, offsetMs: 0 },
        { path: tracks.micWavPath, offsetMs: tracks.micOffsetMs }
      ],
      outputPath: this.mixPath(recording)
    })
  }

  /**
   * トラックごとに文字起こしする。マイク＝自分、システム音声＝相手が確定しているため、
   * 推論なしで 2 話者を正確に分離できる。
   */
  private async transcribe({ recording, settings, tracks }: StepContext): Promise<void> {
    const { language } = settings.transcription

    const mine = await this.deps.transcriber.transcribe({
      wavPath: tracks.micWavPath,
      language,
      speakerId: SELF_SPEAKER_ID
    })
    const theirs = await this.deps.transcriber.transcribe({
      wavPath: tracks.systemWavPath,
      language,
      speakerId: REMOTE_SPEAKER_ID
    })

    const segments = mergeTracks([mine, theirs])
    await this.deps.artifacts.writeTranscript(recording, {
      segments,
      speakers: buildSpeakers(segments)
    })
  }

  /** 相手トラックを話者クラスタに分割し、文字起こしを上書きする。 */
  private async diarize({ recording, settings, tracks }: StepContext): Promise<void> {
    if (!settings.diarization.enabled) return

    const existing = await this.requireTranscript(recording)
    const turns = await this.deps.diarizer.diarize({
      wavPath: tracks.systemWavPath,
      maxSpeakers: settings.diarization.maxSpeakers
    })

    const segments = applyDiarization(existing.segments, turns)
    await this.deps.artifacts.writeTranscript(recording, {
      segments,
      speakers: buildSpeakers(segments)
    })
  }

  private async summarize({ recording, settings }: StepContext): Promise<void> {
    const { segments, speakers } = await this.requireTranscript(recording)
    const summary = await this.deps.summarizer.summarize({
      transcript: toMarkdown(segments, speakers),
      promptTemplate: settings.summarization.promptTemplate
    })

    await this.deps.artifacts.writeSummary(recording, summary)
  }

  private async encode({ recording, settings }: StepContext): Promise<void> {
    await this.deps.encoder.encode({
      inputPath: this.mixPath(recording),
      outputPath: this.deps.artifacts.audioPath(recording),
      bitrateKbps: settings.audio.bitrateKbps
    })
  }

  private mixPath(recording: Recording): string {
    return `${this.deps.artifacts.workDir(recording)}/mix.wav`
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
 */
const buildSpeakers = (segments: readonly TranscriptSegment[]): Speaker[] => {
  const speakers: Speaker[] = []
  const seen = new Set<string>()
  let remoteIndex = 0

  if (segments.some((segment) => segment.speakerId === SELF_SPEAKER_ID)) {
    speakers.push({ id: SELF_SPEAKER_ID, kind: 'self', label: '自分' })
    seen.add(SELF_SPEAKER_ID)
  }

  for (const segment of segments) {
    if (seen.has(segment.speakerId)) continue
    seen.add(segment.speakerId)

    if (isRemoteSpeakerId(segment.speakerId)) {
      const label =
        segment.speakerId === REMOTE_SPEAKER_ID ? '参加者' : defaultRemoteLabel(remoteIndex)
      if (segment.speakerId !== REMOTE_SPEAKER_ID) remoteIndex += 1
      speakers.push({ id: segment.speakerId, kind: 'remote', label })
    } else {
      speakers.push({ id: segment.speakerId, kind: 'self', label: segment.speakerId })
    }
  }

  return speakers
}
