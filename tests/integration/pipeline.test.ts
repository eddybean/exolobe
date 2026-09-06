import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProcessRecording } from '@application/usecases/ProcessRecording'
import { StartRecording } from '@application/usecases/StartRecording'
import { StopRecording } from '@application/usecases/StopRecording'
import { GetRecordingDetail, ListRecordings } from '@application/usecases/library'
import { REMOTE_SPEAKER_ID, SELF_SPEAKER_ID } from '@domain/Speaker'
import { AfconvertEncoder } from '@infrastructure/audio/AfconvertEncoder'
import {
  DualTrackRecorder,
  type SystemAudioSource
} from '@infrastructure/audio/DualTrackRecorder'
import { TrackMixer } from '@infrastructure/audio/TrackMixer'
import { NullDiarizer } from '@infrastructure/diarization/SherpaOnnxDiarizer'
import { int16Buffer, readWav } from '@infrastructure/audio/wav'
import {
  FileRecordingArtifactStore,
  FileRecordingRepository
} from '@infrastructure/persistence/FileRecordingStore'
import { JsonSettingsRepository } from '@infrastructure/settings/JsonSettingsRepository'
import { FakeProgressReporter, FakeSummarizer, FakeTranscriber } from '../application/fakes'

/**
 * 録音開始から保存までを、実際のファイル I/O・WAV 処理・afconvert を通して確認する。
 *
 * 文字起こしと要約だけはモデルを必要とするので差し替える。それ以外は本番と同じ
 * 実装を使うため、配線・ファイル配置・エンコードの実挙動をまとめて検証できる。
 */

const SAMPLE_RATE = 16_000

class ScriptedSystemAudio implements SystemAudioSource {
  private dataListener: (pcm: Buffer) => void = () => {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  onData(listener: (pcm: Buffer) => void): void {
    this.dataListener = listener
  }
  onError(): void {}
  emit(samples: readonly number[]): void {
    this.dataListener(int16Buffer(samples))
  }
}

let storage: string
let userData: string

beforeEach(async () => {
  storage = await mkdtemp(join(tmpdir(), 'omr-e2e-store-'))
  userData = await mkdtemp(join(tmpdir(), 'omr-e2e-data-'))
})

afterEach(async () => {
  await rm(storage, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true })
})

const build = async (options: { summarizerError?: Error } = {}) => {
  const settings = new JsonSettingsRepository(join(userData, 'settings.json'))
  await settings.save({ storageDir: storage })

  const locator = { root: async () => storage }
  const repository = new FileRecordingRepository(locator)
  const artifacts = new FileRecordingArtifactStore(locator, join(userData, 'work'))
  const source = new ScriptedSystemAudio()
  const recorder = new DualTrackRecorder(source)

  const transcriber = new FakeTranscriber()
  const summarizer = new FakeSummarizer()
  summarizer.result = '## 概要\nリリース日を確定した'
  if (options.summarizerError) summarizer.error = options.summarizerError

  return {
    source,
    recorder,
    repository,
    artifacts,
    transcriber,
    start: new StartRecording({
      settings,
      repository,
      capture: recorder,
      artifacts,
      clock: { now: () => new Date('2026-09-06T14:30:00+09:00') },
      ids: { next: () => 'rec-1' }
    }),
    stop: new StopRecording({ repository, capture: recorder, artifacts }),
    process: new ProcessRecording({
      settings,
      repository,
      artifacts,
      transcriber,
      summarizer,
      progress: new FakeProgressReporter(),
      mixer: new TrackMixer(),
      encoder: new AfconvertEncoder(),
      diarizer: new NullDiarizer()
    }),
    list: new ListRecordings({ repository, artifacts }),
    detail: new GetRecordingDetail({ repository, artifacts })
  }
}

/** 話し声に近い複雑さを持つ信号。無音だとエンコード結果の比較が意味を持たない。 */
const speechLike = (seconds: number): number[] => {
  let seed = 7
  let previous = 0
  return Array.from({ length: SAMPLE_RATE * seconds }, () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    const white = (seed / 2_147_483_648) * 12_000 - 6_000
    previous = Math.round(0.75 * previous + 0.25 * white)
    return previous
  })
}

describe('録音から保存までの一連の流れ', () => {
  it('録音・ミックス・文字起こし・要約・エンコードが実ファイルで通る', async () => {
    const ctx = await build()

    // ── 録音 ──
    const started = await ctx.start.execute({ title: 'チーム定例' })
    ctx.source.emit(speechLike(2))
    await ctx.recorder.pushMicPcm(int16Buffer(speechLike(2)))
    const { recording } = await ctx.stop.execute(started.id)

    expect(recording.status).toBe('processing')

    // ── 文字起こしの結果を差し込む ──
    const tracks = await ctx.artifacts.readTracks(recording)
    ctx.transcriber.byPath.set(tracks?.micWavPath ?? '', [
      { startMs: 0, endMs: 1_000, text: '来週リリースで進めます' }
    ])
    ctx.transcriber.byPath.set(tracks?.systemWavPath ?? '', [
      { startMs: 1_200, endMs: 2_000, text: '了解しました' }
    ])

    // ── 後処理 ──
    const processed = await ctx.process.execute({ recordingId: recording.id })
    expect(processed.status).toBe('ready')

    // ── 保存先に成果物が揃っている ──
    const dir = join(storage, recording.slug)
    for (const name of ['audio.m4a', 'transcript.json', 'transcript.md', 'summary.md']) {
      expect((await stat(join(dir, name))).size).toBeGreaterThan(0)
    }

    // ── 中間 WAV は片付いている ──
    const workDir = ctx.artifacts.workDir(processed)
    for (const name of ['system.wav', 'mic.wav', 'mix.wav']) {
      await expect(stat(join(workDir, name))).rejects.toThrow()
    }

    // ── 音声は元の WAV より大幅に小さい ──
    const m4aSize = (await stat(join(dir, 'audio.m4a'))).size
    expect(m4aSize).toBeLessThan(SAMPLE_RATE * 2 * 2 / 4)

    // ── 話者は自分と相手に分かれている ──
    const detail = await ctx.detail.execute(recording.id)
    expect(detail.segments.map((s) => s.speakerId)).toEqual([SELF_SPEAKER_ID, REMOTE_SPEAKER_ID])
    expect(detail.transcriptMarkdown).toBe('自分: 来週リリースで進めます\n参加者: 了解しました')
    expect(detail.summary).toBe('## 概要\nリリース日を確定した')

    // ── コピペ用 Markdown も保存されている ──
    const markdown = await readFile(join(dir, 'transcript.md'), 'utf8')
    expect(markdown).toContain('**[00:00] 自分**')
    expect(markdown).toContain('**[00:01] 参加者**')

    // ── 一覧に要約プレビューつきで出る ──
    const list = await ctx.list.execute()
    expect(list).toHaveLength(1)
    expect(list[0]?.summaryPreview).toBe('概要')
  }, 60_000)

  it('2 トラックを時刻整列してミックスする', async () => {
    const ctx = await build()
    const started = await ctx.start.execute({})

    ctx.source.emit(speechLike(1))
    await ctx.recorder.pushMicPcm(int16Buffer(speechLike(1)))
    const { recording, tracks } = await ctx.stop.execute(started.id)

    // トラックは別々の WAV として残る
    expect((await readWav(tracks.systemWavPath)).samples.length).toBe(SAMPLE_RATE)
    expect((await readWav(tracks.micWavPath)).samples.length).toBe(SAMPLE_RATE)

    ctx.transcriber.byPath.set(tracks.micWavPath, [])
    ctx.transcriber.byPath.set(tracks.systemWavPath, [])

    await ctx.process.execute({ recordingId: recording.id })

    // ミックス後の音声が実際に再生可能な長さを持つ
    expect((await stat(join(storage, recording.slug, 'audio.m4a'))).size).toBeGreaterThan(0)
  }, 60_000)

  it('要約が失敗しても音声とファイル配置は残る', async () => {
    const ctx = await build({ summarizerError: new Error('要約モデルが読み込めません') })
    const started = await ctx.start.execute({})
    ctx.source.emit(speechLike(1))
    const { recording, tracks } = await ctx.stop.execute(started.id)

    ctx.transcriber.byPath.set(tracks.micWavPath, [])
    ctx.transcriber.byPath.set(tracks.systemWavPath, [
      { startMs: 0, endMs: 500, text: 'こんにちは' }
    ])

    const processed = await ctx.process.execute({ recordingId: recording.id })

    expect(processed.status).toBe('failed')
    expect(processed.steps.summarize.status).toBe('failed')
    // 音声とエンコードは完了している
    expect(processed.steps.encode.status).toBe('done')
    expect((await stat(join(storage, recording.slug, 'audio.m4a'))).size).toBeGreaterThan(0)
    // リトライできるよう中間ファイルは残る
    await expect(stat(join(ctx.artifacts.workDir(processed), 'mix.wav'))).resolves.toBeTruthy()
  }, 60_000)
})
