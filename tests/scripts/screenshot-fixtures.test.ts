import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { FileFolderRepository } from '@infrastructure/persistence/FileFolderStore'
import { FileRecordingArtifactStore, FileRecordingRepository } from '@infrastructure/persistence/FileRecordingStore'
import { writeScreenshotFixtures } from '../../scripts/screenshot-fixtures.mjs'
import { notMacOS } from '../platform'

/**
 * README のスクリーンショット用の架空データ。データの形が変わったときに、撮り直す段になって
 * 一覧が空で気付くのでは遅いので、アプリと同じ読み込み口で読めることを確かめておく。
 */
let root: string
let library: string

const locator = { root: async (): Promise<string> => library }

// 音声は afconvert で作るので、架空データの書き出し自体が macOS でしか動かない。
describe.skipIf(notMacOS)('writeScreenshotFixtures', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'screenshot-fixtures-'))
    library = join(root, 'library')
    await writeScreenshotFixtures(root)
  }, 30_000)

  it('userData の設定が保存先として library を指す', async () => {
    const settings = JSON.parse(await readFile(join(root, 'userData', 'settings.json'), 'utf8'))

    expect(settings.storageDir).toBe(library)
  })

  it('5 件の録音が新しい順に読める', async () => {
    const recordings = await new FileRecordingRepository(locator).list()

    expect(recordings.map((recording) => recording.title)).toEqual([
      'Acme 社 リリース範囲の定例',
      '週次の進捗共有',
      'Acme 社 キックオフ',
      '採用面談の振り返り',
      '取り込んだ音声（過去のウェビナー）'
    ])
    expect(recordings.every((recording) => recording.status === 'ready')).toBe(true)
  })

  it('入れ子のフォルダが読める', async () => {
    const folders = await new FileFolderRepository(locator).list()

    expect(folders.find((folder) => folder.name === 'Acme 社')?.parentId).toBe('f-client')
  })

  it('画面の主役の録音は 4 話者の文字起こし・要約・再生できる音声を持つ', async () => {
    const [main] = await new FileRecordingRepository(locator).list()
    if (!main) throw new Error('録音がありません')
    const artifacts = new FileRecordingArtifactStore(locator, join(root, 'work'))

    const transcript = await artifacts.readTranscript(main)
    expect(transcript?.speakers.map((speaker) => speaker.label)).toEqual(['自分', '田中さん', '佐藤さん', '鈴木さん'])
    expect(await artifacts.readSummary(main)).toContain('## 決定事項')
    expect((await stat(join(library, main.slug, 'audio.m4a'))).size).toBeGreaterThan(0)
  })

  it('同じ内容を何度でも作れる（撮り直しで画面が変わらない）', async () => {
    const again = await mkdtemp(join(tmpdir(), 'screenshot-fixtures-'))
    await writeScreenshotFixtures(again)
    const read = async (base: string): Promise<unknown> => {
      const repository = new FileRecordingRepository({ root: async () => join(base, 'library') })
      const artifacts = new FileRecordingArtifactStore({ root: async () => join(base, 'library') }, join(base, 'work'))
      const [main] = await repository.list()
      return main && (await artifacts.readTranscript(main))?.segments
    }

    expect(await read(again)).toEqual(await read(root))
  }, 30_000)
})
