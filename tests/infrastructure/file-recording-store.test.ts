import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FileRecordingArtifactStore,
  FileRecordingRepository,
  type StorageLocator
} from '@infrastructure/persistence/FileRecordingStore'
import { createRecording, finishRecording, succeedStep } from '@domain/Recording'
import { SELF_SPEAKER_ID } from '@domain/Speaker'
import { ConfigurationError } from '@domain/errors'

const startedAt = new Date('2026-09-06T14:30:00+09:00')

let storage: string
let work: string
let locator: StorageLocator
let repository: FileRecordingRepository
let artifacts: FileRecordingArtifactStore

const recording = createRecording({ id: 'rec-1', startedAt, title: 'サンプル会議' })

beforeEach(async () => {
  storage = await mkdtemp(join(tmpdir(), 'omr-store-'))
  work = await mkdtemp(join(tmpdir(), 'omr-work-'))
  locator = { root: async () => storage }
  repository = new FileRecordingRepository(locator)
  artifacts = new FileRecordingArtifactStore(locator, work)
})

afterEach(async () => {
  await rm(storage, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
})

const readStored = async (slug: string, name: string): Promise<unknown> =>
  JSON.parse(await readFile(join(storage, slug, name), 'utf8')) as unknown

const writeStored = async (slug: string, name: string, content: string): Promise<void> => {
  await mkdir(join(storage, slug), { recursive: true })
  await writeFile(join(storage, slug, name), content, 'utf8')
}

describe('FileRecordingRepository', () => {
  it('保存した録音を読み戻せる', async () => {
    await repository.save(recording)

    expect(await repository.find('rec-1')).toEqual(recording)
  })

  it('保存先が空なら空の一覧を返す', async () => {
    expect(await repository.list()).toEqual([])
  })

  it('保存先が未設定でも一覧はエラーにせず空を返す（初回起動）', async () => {
    const unconfigured = new FileRecordingRepository({
      root: () => Promise.reject(new ConfigurationError('保存先が設定されていません。'))
    })

    expect(await unconfigured.list()).toEqual([])
  })

  it('新しい順に並べる', async () => {
    const older = createRecording({ id: 'old', startedAt: new Date('2026-09-01T10:00:00+09:00') })
    await repository.save(older)
    await repository.save(recording)

    expect((await repository.list()).map((r) => r.id)).toEqual(['rec-1', 'old'])
  })

  it('同じ録音を保存し直しても重複しない', async () => {
    await repository.save(recording)
    await repository.save(finishRecording(recording, 1000))

    const all = await repository.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.status).toBe('processing')
  })

  it('録音ディレクトリにも meta.json を残す', async () => {
    await repository.save(recording)

    const meta = JSON.parse(
      await readFile(join(storage, recording.slug, 'meta.json'), 'utf8')
    ) as { id: string }
    expect(meta.id).toBe('rec-1')
  })

  it('index.json を失っても meta.json から一覧を再構築する', async () => {
    await repository.save(recording)
    await rm(join(storage, 'index.json'))

    expect((await repository.list()).map((r) => r.id)).toEqual(['rec-1'])
  })

  it('index.json が壊れていても meta.json から復旧する', async () => {
    await repository.save(recording)
    await writeFile(join(storage, 'index.json'), '{ broken', 'utf8')

    expect((await repository.list()).map((r) => r.id)).toEqual(['rec-1'])
  })

  it('ステップの状態を保持して読み戻す', async () => {
    const processed = { ...recording, steps: succeedStep(recording.steps, 'transcribe') }
    await repository.save(processed)

    expect((await repository.find('rec-1'))?.steps.transcribe).toEqual({ status: 'done' })
  })

  it('削除すると一覧から消える', async () => {
    await repository.save(recording)
    await repository.remove('rec-1')

    expect(await repository.list()).toEqual([])
  })

  it('フォルダIDを保持して読み戻す', async () => {
    await repository.save({ ...recording, folderId: 'f1' })

    expect((await repository.find('rec-1'))?.folderId).toBe('f1')
  })

  it('予定の参加者名を保持して読み戻す', async () => {
    await repository.save({ ...recording, participants: ['山田 太郎', '佐藤 花子'] })

    expect((await repository.find('rec-1'))?.participants).toEqual(['山田 太郎', '佐藤 花子'])
  })

  it('手で壊された参加者名は、文字列だけを拾って読む', async () => {
    await writeStored(
      recording.slug,
      'meta.json',
      JSON.stringify({ ...JSON.parse(JSON.stringify(recording)), participants: ['山田 太郎', 3, null] })
    )

    const [found] = await repository.list()
    expect(found?.participants).toEqual(['山田 太郎'])
  })

  it('meta.json に形式の番号（schemaVersion）を書き込む', async () => {
    await repository.save(recording)

    expect(await readStored(recording.slug, 'meta.json')).toMatchObject({ schemaVersion: 1 })
  })

  it('新しい版が書いた meta.json は上書きしない（古い版で壊さない）', async () => {
    const content = JSON.stringify({ schemaVersion: 2, id: 'rec-1', slug: recording.slug })
    await writeStored(recording.slug, 'meta.json', content)

    await expect(repository.save(recording)).rejects.toThrow('アプリを更新してください')
    expect(await readFile(join(storage, recording.slug, 'meta.json'), 'utf8')).toBe(content)
  })

  it('meta.json の知らないキーを保存で消さず、外したフォルダは外す', async () => {
    await writeStored(
      recording.slug,
      'meta.json',
      JSON.stringify({ id: 'rec-1', slug: recording.slug, folderId: 'f1', futureField: 'keep' })
    )

    await repository.save(recording)

    const meta = await readStored(recording.slug, 'meta.json')
    expect(meta).toMatchObject({ id: 'rec-1', futureField: 'keep' })
    expect(meta).not.toHaveProperty('folderId')
  })
})

describe('FileRecordingArtifactStore', () => {
  const segments = [
    { startMs: 0, endMs: 1000, speakerId: SELF_SPEAKER_ID, text: 'おはようございます' }
  ]
  const speakers = [{ id: SELF_SPEAKER_ID, kind: 'self' as const, label: '自分' }]

  it('文字起こしを JSON と Markdown の両方で保存する', async () => {
    await artifacts.writeTranscript(recording, { segments, speakers })

    expect(await artifacts.readTranscript(recording)).toEqual({ segments, speakers })
    const markdown = await readFile(join(storage, recording.slug, 'transcript.md'), 'utf8')
    expect(markdown).toBe('**[00:00] 自分**\nおはようございます')
  })

  it('transcript.json に形式の番号を書き込み、読むときは本文だけを返す', async () => {
    await artifacts.writeTranscript(recording, { segments, speakers })

    expect(await readStored(recording.slug, 'transcript.json')).toMatchObject({ schemaVersion: 1 })
    expect(await artifacts.readTranscript(recording)).toEqual({ segments, speakers })
  })

  it('新しい版が書いた transcript.json は上書きしない', async () => {
    const content = JSON.stringify({ schemaVersion: 2, segments: [], speakers: [] })
    await writeStored(recording.slug, 'transcript.json', content)

    await expect(artifacts.writeTranscript(recording, { segments, speakers })).rejects.toThrow(
      'アプリを更新してください'
    )
    expect(await readFile(join(storage, recording.slug, 'transcript.json'), 'utf8')).toBe(content)
  })

  it('未作成の文字起こしは undefined を返す', async () => {
    expect(await artifacts.readTranscript(recording)).toBeUndefined()
  })

  it('要約とメモを保存先へ書き出す', async () => {
    await artifacts.writeSummary(recording, '## 概要\n定例会')
    await artifacts.writeNote(recording, '自分用メモ')

    expect(await artifacts.readSummary(recording)).toBe('## 概要\n定例会')
    expect(await artifacts.readNote(recording)).toBe('自分用メモ')
  })

  it('メモが無ければ空文字を返す', async () => {
    expect(await artifacts.readNote(recording)).toBe('')
  })

  it('最終音声は保存先ディレクトリに置く', async () => {
    expect(await artifacts.audioPath(recording)).toBe(join(storage, recording.slug, 'audio.m4a'))
  })

  it('中間ファイルは保存先ではなく作業ディレクトリに置く', async () => {
    expect(artifacts.workDir(recording)).toBe(join(work, 'rec-1'))
  })

  it('2 トラック録音のトラック情報を保存して読み戻せる', async () => {
    const tracks = {
      kind: 'dual' as const,
      systemWavPath: '/work/system.wav',
      micWavPath: '/work/mic.wav',
      micOffsetMs: 120,
      durationMs: 65_000
    }
    await artifacts.writeTracks(recording, tracks)

    expect(await artifacts.readTracks(recording)).toEqual(tracks)
  })

  it('取り込んだ音声のトラック情報を保存して読み戻せる', async () => {
    const tracks = {
      kind: 'single' as const,
      wavPath: '/work/rec-1/imported.wav',
      durationMs: 65_000
    }
    await artifacts.writeTracks(recording, tracks)

    expect(await artifacts.readTracks(recording)).toEqual(tracks)
  })

  /**
   * kind を持たない tracks.json は 2 トラック録音しか無かった頃に書かれたもの。
   * アプリを更新しただけで処理中の録音がリトライできなくなるのを防ぐ。
   */
  it('kind の無い古いトラック情報は 2 トラック録音として読む', async () => {
    await mkdir(artifacts.workDir(recording), { recursive: true })
    await writeFile(
      join(artifacts.workDir(recording), 'tracks.json'),
      JSON.stringify({
        systemWavPath: '/work/system.wav',
        micWavPath: '/work/mic.wav',
        micOffsetMs: 120,
        durationMs: 65_000
      }),
      'utf8'
    )

    expect(await artifacts.readTracks(recording)).toEqual({
      kind: 'dual',
      systemWavPath: '/work/system.wav',
      micWavPath: '/work/mic.wav',
      micOffsetMs: 120,
      durationMs: 65_000
    })
  })

  it('中間ファイルの片付けで作業ディレクトリの WAV だけを消す', async () => {
    await artifacts.writeTracks(recording, {
      kind: 'dual',
      systemWavPath: 'x',
      micWavPath: 'y',
      micOffsetMs: 0,
      durationMs: 0
    })
    await artifacts.writeSummary(recording, '要約')
    await writeFile(join(artifacts.workDir(recording), 'mix.wav'), 'pcm', 'utf8')

    await artifacts.cleanupIntermediates(recording)

    await expect(stat(join(artifacts.workDir(recording), 'mix.wav'))).rejects.toThrow()
    expect(await artifacts.readSummary(recording)).toBe('要約')
  })

  it('中間ファイルの片付けで空の作業ディレクトリも残さない', async () => {
    await artifacts.writeTracks(recording, {
      kind: 'dual',
      systemWavPath: 'x',
      micWavPath: 'y',
      micOffsetMs: 0,
      durationMs: 0
    })

    await artifacts.cleanupIntermediates(recording)

    await expect(stat(artifacts.workDir(recording))).rejects.toThrow()
  })

  it('取り込んだ音声の変換後 WAV も中間ファイルとして片付ける', async () => {
    await artifacts.writeTracks(recording, {
      kind: 'single',
      wavPath: join(artifacts.workDir(recording), 'imported.wav'),
      durationMs: 65_000
    })
    await writeFile(join(artifacts.workDir(recording), 'imported.wav'), 'pcm', 'utf8')

    await artifacts.cleanupIntermediates(recording)

    await expect(stat(join(artifacts.workDir(recording), 'imported.wav'))).rejects.toThrow()
  })

  it('声紋用の一時 WAV を貸したあと空の作業ディレクトリを残さない', async () => {
    await artifacts.withVoicesWav(recording, async (wavPath) => {
      await writeFile(wavPath, 'pcm', 'utf8')
    })

    await expect(stat(artifacts.workDir(recording))).rejects.toThrow()
  })

  it('処理中の中間ファイルがあれば声紋用の片付けでは作業ディレクトリを消さない', async () => {
    await artifacts.writeTracks(recording, {
      kind: 'dual',
      systemWavPath: 'x',
      micWavPath: 'y',
      micOffsetMs: 0,
      durationMs: 0
    })

    await artifacts.withVoicesWav(recording, async (wavPath) => {
      await writeFile(wavPath, 'pcm', 'utf8')
    })

    expect(await artifacts.readTracks(recording)).toBeDefined()
  })

  it('存在しない中間ファイルを消しても失敗しない', async () => {
    await expect(artifacts.cleanupIntermediates(recording)).resolves.toBeUndefined()
  })

  it('削除すると保存先と作業ディレクトリの両方が消える', async () => {
    await artifacts.writeSummary(recording, '要約')
    await artifacts.writeTracks(recording, {
      kind: 'dual',
      systemWavPath: 'x',
      micWavPath: 'y',
      micOffsetMs: 0,
      durationMs: 0
    })

    await artifacts.removeAll(recording)

    await expect(stat(join(storage, recording.slug))).rejects.toThrow()
    await expect(stat(artifacts.workDir(recording))).rejects.toThrow()
  })
})

describe('FileRecordingArtifactStore — 話者の声紋', () => {
  it('書いた声紋を Float32Array として読み戻せる', async () => {
    await artifacts.writeVoices(recording, {
      modelKey: 'campplus:192',
      speakers: [{ speakerId: 'remote:spk0', vector: Float32Array.from([0.6, 0.8]) }]
    })

    const voices = await artifacts.readVoices(recording)

    expect(voices?.modelKey).toBe('campplus:192')
    expect(voices?.speakers[0]?.speakerId).toBe('remote:spk0')
    expect(voices?.speakers[0]?.vector).toBeInstanceOf(Float32Array)
    expect(Array.from(voices?.speakers[0]?.vector ?? [])).toEqual([
      expect.closeTo(0.6),
      expect.closeTo(0.8)
    ])
  })

  it('voices.json に形式の番号を書き込む', async () => {
    await artifacts.writeVoices(recording, {
      modelKey: 'campplus:192',
      speakers: [{ speakerId: 'remote:spk0', vector: Float32Array.from([1, 0]) }]
    })

    expect(await readStored(recording.slug, 'voices.json')).toMatchObject({ schemaVersion: 1 })
  })

  it('新しい版が書いた voices.json は上書きしない', async () => {
    const content = JSON.stringify({ schemaVersion: 2, modelKey: 'x', speakers: [] })
    await writeStored(recording.slug, 'voices.json', content)

    await expect(
      artifacts.writeVoices(recording, { modelKey: 'campplus:192', speakers: [] })
    ).rejects.toThrow('アプリを更新してください')
    expect(await readFile(join(storage, recording.slug, 'voices.json'), 'utf8')).toBe(content)
  })

  it('声紋が無ければ undefined を返す', async () => {
    expect(await artifacts.readVoices(recording)).toBeUndefined()
  })

  it('壊れた声紋ファイルは無いものとして扱う', async () => {
    const dir = join(storage, recording.slug)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'voices.json'), '{"modelKey": 1}', 'utf8')

    expect(await artifacts.readVoices(recording)).toBeUndefined()
  })

  it('数値でない成分を含む声紋は読み飛ばす', async () => {
    const dir = join(storage, recording.slug)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'voices.json'),
      JSON.stringify({
        modelKey: 'campplus:192',
        speakers: [
          { speakerId: 'remote:spk0', vector: [null, 1] },
          { speakerId: 'remote:spk1', vector: [0, 1] }
        ]
      }),
      'utf8'
    )

    const voices = await artifacts.readVoices(recording)
    expect(voices?.speakers.map((s) => s.speakerId)).toEqual(['remote:spk1'])
  })

  it('録音を消すと声紋も消える', async () => {
    await artifacts.writeVoices(recording, {
      modelKey: 'campplus:192',
      speakers: [{ speakerId: 'remote:spk0', vector: Float32Array.from([1, 0]) }]
    })

    await artifacts.removeAll(recording)

    expect(await artifacts.readVoices(recording)).toBeUndefined()
  })
})
