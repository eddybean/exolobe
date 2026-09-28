import { beforeEach, describe, expect, it } from 'vitest'
import { ImportAudioFile } from '@application/usecases/ImportAudioFile'
import { MINIMUM_RECORDING_MS } from '@domain/Recording'
import { defaultSettings } from '@domain/Settings'
import {
  FakeArtifactStore,
  FakeAudioDecoder,
  FakeClock,
  FakeFileInfo,
  FakeIdGenerator,
  FakeRecordingRepository,
  FakeSettingsRepository
} from './fakes'

const now = new Date('2026-09-12T18:00:00+09:00')
const modifiedAt = new Date('2026-09-06T14:30:00+09:00')
const SOURCE = '/Users/me/Downloads/9月の定例.m4a'

const build = (settings = new FakeSettingsRepository()) => {
  const repository = new FakeRecordingRepository()
  const artifacts = new FakeArtifactStore()
  const decoder = new FakeAudioDecoder()
  const files = new FakeFileInfo()
  files.entries.set(SOURCE, { sizeBytes: 3_000_000, modifiedAt })

  const deps = {
    settings,
    repository,
    artifacts,
    decoder,
    files,
    clock: new FakeClock(now),
    ids: new FakeIdGenerator()
  }

  return { ...deps, importAudioFile: new ImportAudioFile(deps) }
}

describe('ImportAudioFile — 正常系', () => {
  let ctx: ReturnType<typeof build>

  beforeEach(() => {
    ctx = build()
  })

  it('ファイル名をタイトル、更新日時を開始日時にした録音を作る', async () => {
    const recording = await ctx.importAudioFile.execute({ filePath: SOURCE })

    expect(recording.title).toBe('9月の定例')
    expect(recording.startedAt).toEqual(modifiedAt)
    expect(recording.slug).toBe('2026-09-06_1430-rec-1')
  })

  it('設定のサンプルレートで作業ディレクトリへ変換する', async () => {
    const recording = await ctx.importAudioFile.execute({ filePath: SOURCE })

    expect(ctx.decoder.calls).toEqual([
      {
        inputPath: SOURCE,
        outputPath: `${ctx.artifacts.workDir(recording)}/imported.wav`,
        sampleRate: 16_000
      }
    ])
  })

  it('単一ソースとしてトラック情報を残し、処理中として保存する', async () => {
    const recording = await ctx.importAudioFile.execute({ filePath: SOURCE })

    expect(await ctx.artifacts.readTracks(recording)).toEqual({
      kind: 'single',
      wavPath: `${ctx.artifacts.workDir(recording)}/imported.wav`,
      durationMs: 65_000
    })
    expect(recording.status).toBe('processing')
    expect(recording.durationMs).toBe(65_000)
    expect(await ctx.repository.find(recording.id)).toEqual(recording)
  })

  it('指定が無ければ未分類に入れる', async () => {
    const recording = await ctx.importAudioFile.execute({ filePath: SOURCE })

    expect(recording.folderId).toBeUndefined()
  })

  it('フォルダを指定すればそこに入れる', async () => {
    const recording = await ctx.importAudioFile.execute({ filePath: SOURCE, folderId: 'f1' })

    expect(recording.folderId).toBe('f1')
  })

  /** 更新日時が読めない環境でも取り込みを諦めない（MemoryGuard と同じ安全側）。 */
  it('更新日時が取れなければ現在時刻を開始日時にする', async () => {
    ctx.files.entries.set(SOURCE, { sizeBytes: 1, modifiedAt: new Date(Number.NaN) })

    const recording = await ctx.importAudioFile.execute({ filePath: SOURCE })

    expect(recording.startedAt).toEqual(now)
  })
})

describe('ImportAudioFile — 断る場合', () => {
  it('保存先が未設定なら取り込まない', async () => {
    const ctx = build(new FakeSettingsRepository(defaultSettings()))

    await expect(ctx.importAudioFile.execute({ filePath: SOURCE })).rejects.toThrow(
      'storageNotConfigured'
    )
    expect(ctx.repository.records.size).toBe(0)
  })

  it('対応していない形式は変換を始めずに断る', async () => {
    const ctx = build()
    ctx.files.entries.set('/x/会議.webm', { sizeBytes: 1, modifiedAt })

    await expect(ctx.importAudioFile.execute({ filePath: '/x/会議.webm' })).rejects.toMatchObject({
      reason: { code: 'importUnreadableFormat', fileName: '会議.webm', extension: 'webm' }
    })
    expect(ctx.decoder.calls).toEqual([])
    expect(ctx.repository.records.size).toBe(0)
  })

  it('読めないファイルは理由を返す', async () => {
    const ctx = build()

    await expect(ctx.importAudioFile.execute({ filePath: '/x/missing.mp3' })).rejects.toThrow(
      'fileUnreadable'
    )
    expect(ctx.repository.records.size).toBe(0)
  })

  /** 変換に失敗したら空の録音を一覧に残さない（StartRecording と同じ順序の約束）。 */
  it('変換に失敗したら録音を作らない', async () => {
    const ctx = build()
    ctx.decoder.error = new Error('音声を読み取れませんでした。')

    await expect(ctx.importAudioFile.execute({ filePath: SOURCE })).rejects.toThrow(
      '音声を読み取れませんでした。'
    )
    expect(ctx.repository.records.size).toBe(0)
    expect(ctx.artifacts.tracks.size).toBe(0)
  })

  it('1 分未満は録音を作らず、変換後の WAV も捨てる', async () => {
    const ctx = build()
    ctx.decoder.durationMs = MINIMUM_RECORDING_MS - 1_000

    await expect(ctx.importAudioFile.execute({ filePath: SOURCE })).rejects.toThrow(
      'tooShortRecording'
    )
    expect(ctx.repository.records.size).toBe(0)
    expect(ctx.artifacts.cleanedUp).toEqual(['rec-1'])
  })
})
