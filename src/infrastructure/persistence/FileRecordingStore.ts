import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  CapturedTracks,
  RecordingArtifactPort,
  RecordingRepositoryPort
} from '@application/ports'
import {
  PIPELINE_STEPS,
  initialStepStates,
  type Recording,
  type RecordingStatus,
  type StepState,
  type StepStates
} from '@domain/Recording'
import { AppError } from '@domain/errors'
import type { Speaker } from '@domain/Speaker'
import { toMarkdown } from '@domain/Transcript'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

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

interface RecordingRecord {
  id: string
  title: string
  startedAt: string
  durationMs: number
  status: RecordingStatus
  steps: Record<string, StepState>
  slug: string
}

const toRecord = (recording: Recording): RecordingRecord => ({
  id: recording.id,
  title: recording.title,
  startedAt: recording.startedAt.toISOString(),
  durationMs: recording.durationMs,
  status: recording.status,
  steps: recording.steps,
  slug: recording.slug
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
    slug: record.slug
  }
}

const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    // 未作成・壊れた JSON はどちらも「まだ無い」として扱い、起動を止めない。
    return undefined
  }
}

/** 書き込み途中の電源断で壊れたファイルを残さないよう、一時ファイル経由で置換する。 */
const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
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
    const root = await this.locator.root()
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

const isTracks = (value: unknown): value is CapturedTracks => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CapturedTracks>
  return typeof candidate.systemWavPath === 'string' && typeof candidate.micWavPath === 'string'
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

  async readTracks(recording: Recording): Promise<CapturedTracks | undefined> {
    const value = await readJson(join(this.workDir(recording), TRACKS_FILE))
    return isTracks(value) ? value : undefined
  }

  async writeTracks(recording: Recording, tracks: CapturedTracks): Promise<void> {
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

  async cleanupIntermediates(recording: Recording): Promise<void> {
    const dir = this.workDir(recording)
    for (const name of ['system.wav', 'mic.wav', 'mix.wav', TRACKS_FILE]) {
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
