import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  RecordingArtifactPort,
  RecordingRepositoryPort,
  RecordingSource
} from '@application/ports'
import {
  PIPELINE_STEPS,
  initialStepStates,
  type Recording,
  type RecordingStatus,
  type StepState,
  type StepStates
} from '@domain/Recording'
import { AppError, ConfigurationError } from '@domain/errors'
import type { Speaker } from '@domain/Speaker'
import { toMarkdown } from '@domain/Transcript'
import type { TranscriptSegment } from '@domain/TranscriptSegment'
import { isVoiceVector, type RecordingVoices, type SpeakerVector } from '@domain/Voiceprint'
import { readJson, writeJsonAtomic } from './jsonFile'

export class StorageError extends AppError {}

/** 保存先ルートの解決。設定変更で変わるため、都度問い合わせる。 */
export interface StorageLocator {
  root(): Promise<string>
}

const INDEX_FILE = 'index.json'
const META_FILE = 'meta.json'
const TRANSCRIPT_JSON = 'transcript.json'
const TRANSCRIPT_MD = 'transcript.md'
const SUMMARY_MD = 'summary.md'
const NOTE_MD = 'note.md'
const TRACKS_FILE = 'tracks.json'
const VOICES_FILE = 'voices.json'
const VOICES_WAV = 'voices.wav'

interface RecordingRecord {
  id: string
  title: string
  startedAt: string
  durationMs: number
  status: RecordingStatus
  steps: Record<string, StepState>
  slug: string
  folderId?: string
}

const toRecord = (recording: Recording): RecordingRecord => ({
  id: recording.id,
  title: recording.title,
  startedAt: recording.startedAt.toISOString(),
  durationMs: recording.durationMs,
  status: recording.status,
  steps: recording.steps,
  slug: recording.slug,
  ...(recording.folderId === undefined ? {} : { folderId: recording.folderId })
})

const isRecord = (value: unknown): value is RecordingRecord => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<RecordingRecord>
  return typeof candidate.id === 'string' && typeof candidate.slug === 'string'
}

/** 保存済み JSON は手で編集され得るため、欠けたステップは pending で補う。 */
const toDomain = (record: RecordingRecord): Recording => {
  const steps = { ...initialStepStates() } as Record<string, StepState>
  for (const step of PIPELINE_STEPS) {
    const saved = record.steps?.[step]
    if (saved && typeof saved.status === 'string') steps[step] = saved
  }

  return {
    id: record.id,
    title: record.title,
    startedAt: new Date(record.startedAt),
    durationMs: record.durationMs,
    status: record.status,
    steps: steps as StepStates,
    slug: record.slug,
    ...(record.folderId === undefined ? {} : { folderId: record.folderId })
  }
}

/**
 * 録音メタデータの保管庫。
 *
 * 各録音ディレクトリの meta.json を正とし、ルートの index.json は一覧表示を
 * 速くするためのキャッシュとして扱う。index.json を失っても meta.json から
 * 再構築できるため、ユーザーがディレクトリを移動・整理しても壊れない。
 */
export class FileRecordingRepository implements RecordingRepositoryPort {
  constructor(private readonly locator: StorageLocator) {}

  async list(): Promise<Recording[]> {
    // 初回起動では保存先がまだ決まっていない。一覧の取得はアプリ起動直後に
    // 走るので、ここで例外を投げると初期設定画面を出す前にエラーになる。
    // 保存先が無い＝録音も無いので、空の一覧として扱う。
    const root = await this.rootOrUndefined()
    if (root === undefined) return []

    const cached = await readJson(join(root, INDEX_FILE))
    const records = Array.isArray(cached) ? cached.filter(isRecord) : await this.scan(root)

    return records.map(toDomain).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
  }

  async find(id: string): Promise<Recording | undefined> {
    return (await this.list()).find((recording) => recording.id === id)
  }

  async save(recording: Recording): Promise<void> {
    const root = await this.locator.root()
    const record = toRecord(recording)

    await writeJsonAtomic(join(root, recording.slug, META_FILE), record)

    const others = (await this.list()).filter((other) => other.id !== recording.id)
    await writeJsonAtomic(join(root, INDEX_FILE), [...others.map(toRecord), record])
  }

  async remove(id: string): Promise<void> {
    const root = await this.locator.root()
    const remaining = (await this.list()).filter((recording) => recording.id !== id)
    await writeJsonAtomic(join(root, INDEX_FILE), remaining.map(toRecord))
  }

  private async rootOrUndefined(): Promise<string | undefined> {
    try {
      return await this.locator.root()
    } catch (error: unknown) {
      if (error instanceof ConfigurationError) return undefined
      throw error
    }
  }

  /** index.json が無い・壊れている場合に各ディレクトリの meta.json から作り直す。 */
  private async scan(root: string): Promise<RecordingRecord[]> {
    let entries: string[]
    try {
      entries = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return []
    }

    const records = await Promise.all(
      entries.map(async (name) => await readJson(join(root, name, META_FILE)))
    )

    return records.filter(isRecord)
  }
}

interface TranscriptFile {
  segments: TranscriptSegment[]
  speakers: Speaker[]
}

const isTranscriptFile = (value: unknown): value is TranscriptFile => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<TranscriptFile>
  return Array.isArray(candidate.segments) && Array.isArray(candidate.speakers)
}

const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0)

/**
 * voices.json を話者の声紋として読む。
 *
 * JSON に Float32Array は無いので数値配列で持ち、読むときに戻す。声紋は名前を
 * 引き当てるためだけの補助データなので、壊れていれば無いものとして扱う。
 * 話者名を変えられなくなるより、その録音ぶんの学習を諦めるほうが軽い。
 */
const toVoices = (value: unknown): RecordingVoices | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { modelKey?: unknown; speakers?: unknown }
  if (typeof candidate.modelKey !== 'string' || !Array.isArray(candidate.speakers)) {
    return undefined
  }

  const speakers: SpeakerVector[] = []
  for (const entry of candidate.speakers) {
    if (typeof entry !== 'object' || entry === null) continue
    const speaker = entry as { speakerId?: unknown; vector?: unknown }
    if (typeof speaker.speakerId !== 'string' || !isVoiceVector(speaker.vector)) continue
    speakers.push({
      speakerId: speaker.speakerId,
      vector: Float32Array.from(speaker.vector)
    })
  }

  return { modelKey: candidate.modelKey, speakers }
}

/**
 * tracks.json を音の素材として読む。
 *
 * kind を持たないファイルは 2 トラック録音しか無かった頃に書かれたもので、当時の形は
 * 必ず dual だったので補って返す（meta.json の欠けたステップを pending で補うのと同じ）。
 * アプリを更新しただけで処理中だった録音のリトライが壊れないようにするため。
 */
const toSource = (value: unknown): RecordingSource | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>

  if (candidate['kind'] === 'single') {
    return typeof candidate['wavPath'] === 'string'
      ? {
          kind: 'single',
          wavPath: candidate['wavPath'],
          durationMs: asNumber(candidate['durationMs'])
        }
      : undefined
  }

  if (typeof candidate['systemWavPath'] !== 'string' || typeof candidate['micWavPath'] !== 'string') {
    return undefined
  }

  return {
    kind: 'dual',
    systemWavPath: candidate['systemWavPath'],
    micWavPath: candidate['micWavPath'],
    micOffsetMs: asNumber(candidate['micOffsetMs']),
    durationMs: asNumber(candidate['durationMs'])
  }
}

/**
 * 1 件の録音に紐づくファイル群を扱う。
 *
 * 保存先には利用者が他のツールからも読める形（m4a / Markdown / JSON）だけを置き、
 * 録音中の中間 WAV はアプリの作業ディレクトリに隔離してエンコード後に消す。
 */
export class FileRecordingArtifactStore implements RecordingArtifactPort {
  constructor(
    private readonly locator: StorageLocator,
    /** 中間 WAV を置く場所。保存先を汚さないよう app.getPath('userData') 配下を想定。 */
    private readonly workRoot: string
  ) {}

  workDir(recording: Recording): string {
    return join(this.workRoot, recording.id)
  }

  async audioPath(recording: Recording): Promise<string> {
    return join(await this.dir(recording), 'audio.m4a')
  }

  async readTracks(recording: Recording): Promise<RecordingSource | undefined> {
    return toSource(await readJson(join(this.workDir(recording), TRACKS_FILE)))
  }

  async writeTracks(recording: Recording, tracks: RecordingSource): Promise<void> {
    await writeJsonAtomic(join(this.workDir(recording), TRACKS_FILE), tracks)
  }

  async readTranscript(recording: Recording): Promise<TranscriptFile | undefined> {
    const value = await readJson(join(await this.dir(recording), TRANSCRIPT_JSON))
    return isTranscriptFile(value) ? value : undefined
  }

  async writeTranscript(
    recording: Recording,
    data: { segments: readonly TranscriptSegment[]; speakers: readonly Speaker[] }
  ): Promise<void> {
    const dir = await this.dir(recording)
    await writeJsonAtomic(join(dir, TRANSCRIPT_JSON), {
      segments: data.segments,
      speakers: data.speakers
    })
    // 機械可読な JSON と、そのままコピペできる Markdown の両方を残す。
    await this.writeText(join(dir, TRANSCRIPT_MD), toMarkdown(data.segments, data.speakers))
  }

  async readVoices(recording: Recording): Promise<RecordingVoices | undefined> {
    return toVoices(await readJson(join(await this.dir(recording), VOICES_FILE)))
  }

  async writeVoices(recording: Recording, voices: RecordingVoices): Promise<void> {
    await writeJsonAtomic(join(await this.dir(recording), VOICES_FILE), {
      modelKey: voices.modelKey,
      speakers: voices.speakers.map((speaker) => ({
        speakerId: speaker.speakerId,
        vector: Array.from(speaker.vector)
      }))
    })
  }

  async readSummary(recording: Recording): Promise<string | undefined> {
    return this.readText(join(await this.dir(recording), SUMMARY_MD))
  }

  async writeSummary(recording: Recording, markdown: string): Promise<void> {
    await this.writeText(join(await this.dir(recording), SUMMARY_MD), markdown)
  }

  async readNote(recording: Recording): Promise<string> {
    return (await this.readText(join(await this.dir(recording), NOTE_MD))) ?? ''
  }

  async writeNote(recording: Recording, markdown: string): Promise<void> {
    await this.writeText(join(await this.dir(recording), NOTE_MD), markdown)
  }

  /**
   * 声紋を取り直すための一時 WAV を貸す。
   *
   * work/ 側に置く。保存先は利用者が他のツールからも見る場所で、処理の途中でしか
   * 意味を持たない 100MB 超のファイルを置く場所ではない。
   */
  async withVoicesWav<T>(recording: Recording, run: (wavPath: string) => Promise<T>): Promise<T> {
    const dir = this.workDir(recording)
    await mkdir(dir, { recursive: true })
    const wavPath = join(dir, VOICES_WAV)

    try {
      return await run(wavPath)
    } finally {
      await rm(wavPath, { force: true })
    }
  }

  async cleanupIntermediates(recording: Recording): Promise<void> {
    const dir = this.workDir(recording)
    // 取り込み由来の imported.wav も常に対象にする。録音由来のものには存在しないだけで、
    // どちらだったかを知るために消す直前の tracks.json を読む理由が無い（rm は force）。
    // voices.wav は取り直しが落ちたときの取りこぼし。
    for (const name of ['system.wav', 'mic.wav', 'imported.wav', 'mix.wav', VOICES_WAV, TRACKS_FILE]) {
      await rm(join(dir, name), { force: true })
    }
  }

  async removeAll(recording: Recording): Promise<void> {
    await rm(await this.dir(recording), { recursive: true, force: true })
    await rm(this.workDir(recording), { recursive: true, force: true })
  }

  private async dir(recording: Recording): Promise<string> {
    const dir = join(await this.locator.root(), recording.slug)
    await mkdir(dir, { recursive: true })
    return dir
  }

  private async readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return undefined
    }
  }

  private async writeText(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  }
}
