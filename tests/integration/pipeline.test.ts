import { mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImportAudioFile } from '@application/usecases/ImportAudioFile'
import { ProcessRecording } from '@application/usecases/ProcessRecording'
import { NodeFileInfoProbe } from '@infrastructure/system/NodeFileInfoProbe'
import { NodeSystemResourceProbe } from '@infrastructure/system/NodeSystemResourceProbe'
import { StartRecording } from '@application/usecases/StartRecording'
import { StopRecording } from '@application/usecases/StopRecording'
import { GetRecordingDetail, ListRecordings } from '@application/usecases/library'
import { REMOTE_SPEAKER_ID, SELF_SPEAKER_ID } from '@domain/Speaker'
import { AfconvertDecoder } from '@infrastructure/audio/AfconvertDecoder'
import { AfconvertEncoder } from '@infrastructure/audio/AfconvertEncoder'
import { DualTrackRecorder, type SystemAudioSource } from '@infrastructure/audio/DualTrackRecorder'
import { TrackMixer } from '@infrastructure/audio/TrackMixer'
import { NullDiarizer } from '@infrastructure/diarization/SherpaOnnxDiarizer'
import { NullSpeakerEmbedder } from '@infrastructure/diarization/SherpaOnnxSpeakerEmbedder'
import { FileVoiceprintRepository } from '@infrastructure/persistence/FileVoiceprintStore'
import { WavFileWriter, int16Buffer, readWav } from '@infrastructure/audio/wav'
import { FileRecordingArtifactStore, FileRecordingRepository } from '@infrastructure/persistence/FileRecordingStore'
import { JsonSettingsRepository } from '@infrastructure/settings/JsonSettingsRepository'
import { FakeCalendar, FakeProgressReporter, FakeSummarizer, FakeTranscriber } from '../application/fakes'
import { notMacOS } from '../platform'

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
/** 取り込み元のファイルを置く場所。利用者の手元にあるファイルに相当する。 */
let inbox: string

beforeEach(async () => {
  storage = await mkdtemp(join(tmpdir(), 'omr-e2e-store-'))
  userData = await mkdtemp(join(tmpdir(), 'omr-e2e-data-'))
  inbox = await mkdtemp(join(tmpdir(), 'omr-e2e-inbox-'))
})

afterEach(async () => {
  await rm(storage, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true })
  await rm(inbox, { recursive: true, force: true })
})

const build = async (options: { summarizerError?: Error } = {}) => {
  const settings = new JsonSettingsRepository(join(userData, 'settings.json'), 'ja')
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
      calendar: new FakeCalendar(),
      clock: { now: () => new Date('2026-09-06T14:30:00+09:00') },
      ids: { next: () => 'rec-1' },
      fallbackLanguage: 'ja'
    }),
    stop: new StopRecording({ repository, capture: recorder, artifacts }),
    importAudioFile: new ImportAudioFile({
      settings,
      repository,
      artifacts,
      decoder: new AfconvertDecoder(),
      files: new NodeFileInfoProbe(),
      clock: { now: () => new Date('2026-09-06T14:30:00+09:00') },
      ids: { next: () => 'rec-1' }
    }),
    process: new ProcessRecording({
      settings,
      fallbackLanguage: 'ja',
      repository,
      artifacts,
      system: new NodeSystemResourceProbe(),
      transcriber,
      summarizer,
      progress: new FakeProgressReporter(),
      mixer: new TrackMixer(),
      encoder: new AfconvertEncoder(),
      diarizer: new NullDiarizer(),
      embedder: new NullSpeakerEmbedder(),
      voiceprints: new FileVoiceprintRepository(locator)
    }),
    list: new ListRecordings({ repository, artifacts }),
    detail: new GetRecordingDetail({ repository, artifacts })
  }
}

/**
 * 流す音声の長さ。1 分未満の録音はパイプラインが 1 ステップも実行せず中断する
 * （tooShortRecording）ため、一連の流れを通すにはその境目を越える必要がある。
 */
const RECORDING_SECONDS = 61

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

describe.skipIf(notMacOS)('録音から保存までの一連の流れ', () => {
  it('録音・ミックス・文字起こし・要約・エンコードが実ファイルで通る', async () => {
    const ctx = await build()

    // ── 録音 ──
    const started = await ctx.start.execute({ title: 'サンプル会議' })
    ctx.source.emit(speechLike(RECORDING_SECONDS))
    await ctx.recorder.pushMicPcm(int16Buffer(speechLike(RECORDING_SECONDS)))
    const { recording, tracks } = await ctx.stop.execute(started.id)

    expect(recording.status).toBe('processing')

    // ── 文字起こしの結果を差し込む ──
    ctx.transcriber.byPath.set(tracks.micWavPath, [{ startMs: 0, endMs: 1_000, text: '来週リリースで進めます' }])
    ctx.transcriber.byPath.set(tracks.systemWavPath, [{ startMs: 1_200, endMs: 2_000, text: '了解しました' }])

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
    expect(m4aSize).toBeLessThan((SAMPLE_RATE * RECORDING_SECONDS * 2) / 4)

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

    ctx.source.emit(speechLike(RECORDING_SECONDS))
    await ctx.recorder.pushMicPcm(int16Buffer(speechLike(RECORDING_SECONDS)))
    const { recording, tracks } = await ctx.stop.execute(started.id)

    // トラックは別々の WAV として残る
    const recorded = SAMPLE_RATE * RECORDING_SECONDS
    expect((await readWav(tracks.systemWavPath)).samples.length).toBe(recorded)
    expect((await readWav(tracks.micWavPath)).samples.length).toBe(recorded)

    ctx.transcriber.byPath.set(tracks.micWavPath, [])
    ctx.transcriber.byPath.set(tracks.systemWavPath, [])

    await ctx.process.execute({ recordingId: recording.id })

    // ミックス後の音声が実際に再生可能な長さを持つ
    expect((await stat(join(storage, recording.slug, 'audio.m4a'))).size).toBeGreaterThan(0)
  }, 60_000)

  it('要約が失敗しても音声とファイル配置は残る', async () => {
    const ctx = await build({ summarizerError: new Error('要約モデルが読み込めません') })
    const started = await ctx.start.execute({})
    ctx.source.emit(speechLike(RECORDING_SECONDS))
    const { recording, tracks } = await ctx.stop.execute(started.id)

    ctx.transcriber.byPath.set(tracks.micWavPath, [])
    ctx.transcriber.byPath.set(tracks.systemWavPath, [{ startMs: 0, endMs: 500, text: 'こんにちは' }])

    const processed = await ctx.process.execute({ recordingId: recording.id })

    expect(processed.status).toBe('failed')
    expect(processed.steps.summarize.status).toBe('failed')
    // 音声とエンコードは完了している
    expect(processed.steps.encode.status).toBe('done')
    expect((await stat(join(storage, recording.slug, 'audio.m4a'))).size).toBeGreaterThan(0)
    // 要約のリトライに要るのは文字起こしだけなので、中間ファイルは作業ディレクトリごと消える
    await expect(stat(join(storage, recording.slug, 'transcript.json'))).resolves.toBeTruthy()
    await expect(stat(ctx.artifacts.workDir(processed))).rejects.toThrow()
  }, 60_000)
})

/**
 * 取り込みは実際の afconvert を通す。拡張子の判定・変換・ミックス・エンコードの
 * 結線が噛み合っていることを、Fake で差し替えずに確かめる。
 */
describe.skipIf(notMacOS)('音声ファイルの取り込み', () => {
  /** 取り込み元になる 2ch の WAV を書く。録音とは違うサンプルレートにして変換を効かせる。 */
  const writeSource = async (name: string, seconds: number): Promise<string> => {
    const path = join(inbox, name)
    const writer = await WavFileWriter.create(path, { sampleRate: 44_100, channels: 2 })
    const mono = speechLike44k(seconds)
    const interleaved: number[] = []
    for (const sample of mono) interleaved.push(sample, Math.round(sample * 0.6))
    await writer.write(int16Buffer(interleaved))
    await writer.close()
    return path
  }

  const speechLike44k = (seconds: number): number[] => {
    let seed = 13
    let previous = 0
    return Array.from({ length: 44_100 * seconds }, () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      const white = (seed / 2_147_483_648) * 12_000 - 6_000
      previous = Math.round(0.75 * previous + 0.25 * white)
      return previous
    })
  }

  it('取り込みから保存までが実ファイルで通る', async () => {
    const ctx = await build()
    const source = await writeSource('取り込み用の会議.wav', RECORDING_SECONDS)

    const recording = await ctx.importAudioFile.execute({ filePath: source })

    // ファイル名がタイトルになり、更新日時が開始日時になる
    expect(recording.title).toBe('取り込み用の会議')
    expect(recording.status).toBe('processing')

    const imported = join(ctx.artifacts.workDir(recording), 'imported.wav')
    const wav = await readWav(imported)
    expect(wav.sampleRate).toBe(SAMPLE_RATE)
    expect(wav.channels).toBe(1)

    ctx.transcriber.byPath.set(imported, [{ startMs: 0, endMs: 1_000, text: '来週リリースします' }])

    const processed = await ctx.process.execute({ recordingId: recording.id })
    expect(processed.status).toBe('ready')

    // 相手側として 1 回だけ文字起こしされ、「自分」は現れない
    expect(ctx.transcriber.calls).toEqual([{ wavPath: imported, speakerId: REMOTE_SPEAKER_ID }])
    const detail = await ctx.detail.execute(recording.id)
    expect(detail.transcriptMarkdown).toBe('参加者: 来週リリースします')

    // 保存先に成果物が揃い、中間 WAV は片付いている
    const dir = join(storage, recording.slug)
    for (const name of ['audio.m4a', 'transcript.json', 'transcript.md', 'summary.md']) {
      expect((await stat(join(dir, name))).size).toBeGreaterThan(0)
    }
    for (const name of ['imported.wav', 'mix.wav']) {
      await expect(stat(join(ctx.artifacts.workDir(processed), name))).rejects.toThrow()
    }
  }, 60_000)

  it('1 分未満は取り込まず、保存先にディレクトリも作らない', async () => {
    const ctx = await build()
    const source = await writeSource('短い.wav', 2)

    await expect(ctx.importAudioFile.execute({ filePath: source })).rejects.toMatchObject({
      reason: { code: 'tooShortRecording' }
    })
    expect(await ctx.list.execute()).toEqual([])
    expect(await readdir(storage)).toEqual([])
  }, 60_000)

  it('対応していない形式は afconvert を呼ばずに断る', async () => {
    const ctx = await build()
    const source = await writeSource('会議.wav', 2)
    const renamed = source.replace(/\.wav$/, '.webm')
    await rename(source, renamed)

    await expect(ctx.importAudioFile.execute({ filePath: renamed })).rejects.toMatchObject({
      reason: { code: 'importUnreadableFormat', extension: 'webm' }
    })
    expect(await ctx.list.execute()).toEqual([])
  }, 60_000)
})
