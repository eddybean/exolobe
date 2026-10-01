import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonSettingsRepository, SettingsStorageLocator } from '@infrastructure/settings/JsonSettingsRepository'
import { DEFAULT_SUMMARY_PROMPT_EN, TRANSCRIPT_PLACEHOLDER, defaultSettings } from '@domain/Settings'

let dir: string
let filePath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omr-settings-'))
  filePath = join(dir, 'nested', 'settings.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('JsonSettingsRepository', () => {
  it('未作成なら既定値を返す', async () => {
    expect(await new JsonSettingsRepository(filePath, 'ja').load()).toEqual(defaultSettings('ja'))
  })

  it('未作成なら、渡された言語の既定値を返す（新しく入れた人の文字起こしの言語）', async () => {
    const settings = await new JsonSettingsRepository(filePath, 'en').load()

    expect(settings.transcription.language).toBe('en')
  })

  it('保存済みの言語は、渡された言語より優先する', async () => {
    await new JsonSettingsRepository(filePath, 'ja').save({ storageDir: '/Users/me/Meetings' })

    const settings = await new JsonSettingsRepository(filePath, 'en').load()

    expect(settings.transcription.language).toBe('ja')
  })

  it('保存した設定を別インスタンスから読み戻せる', async () => {
    await new JsonSettingsRepository(filePath, 'ja').save({ storageDir: '/Users/me/Meetings' })

    expect((await new JsonSettingsRepository(filePath, 'ja').load()).storageDir).toBe('/Users/me/Meetings')
  })

  it('部分更新で他の設定を失わない', async () => {
    const repository = new JsonSettingsRepository(filePath, 'ja')
    await repository.save({ storageDir: '/Users/me/Meetings' })
    await repository.save({ audio: { bitrateKbps: 64 } })

    const settings = await repository.load()
    expect(settings.storageDir).toBe('/Users/me/Meetings')
    expect(settings.audio.bitrateKbps).toBe(64)
    expect(settings.audio.sampleRate).toBe(16_000)
  })

  it('保存済みファイルに無いキーは既定値で補う（アプリ更新後の互換性）', async () => {
    const legacy = join(dir, 'legacy.json')
    await writeFile(legacy, JSON.stringify({ storageDir: '/old' }), 'utf8')

    const settings = await new JsonSettingsRepository(legacy, 'ja').load()
    expect(settings.storageDir).toBe('/old')
    expect(settings.audio).toEqual(defaultSettings('ja').audio)
  })

  /** 選び方（ADR-047）を足す前は、全文が既定と一致するかで「書き換えたか」を見ていた。 */
  describe('要約プロンプトの選び方を持たない設定', () => {
    const load = async (summarization: object) => {
      const legacy = join(dir, 'legacy.json')
      await writeFile(legacy, JSON.stringify({ summarization }), 'utf8')
      return new JsonSettingsRepository(legacy, 'ja').load()
    }

    it('書き換えたプロンプトはカスタムとして読む', async () => {
      const settings = await load({ promptTemplate: `箇条書きで\n${TRANSCRIPT_PLACEHOLDER}` })

      expect(settings.summarization.promptMode).toBe('custom')
      expect(settings.summarization.promptTemplate).toBe(`箇条書きで\n${TRANSCRIPT_PLACEHOLDER}`)
    })

    it('既定の全文のままなら既定として読む', async () => {
      const settings = await load({ promptTemplate: DEFAULT_SUMMARY_PROMPT_EN })

      expect(settings.summarization.promptMode).toBe('default')
    })

    it('保存済みの選び方があれば、本文からは推し量らない', async () => {
      const settings = await load({
        promptMode: 'default',
        promptTemplate: `箇条書きで\n${TRANSCRIPT_PLACEHOLDER}`
      })

      expect(settings.summarization.promptMode).toBe('default')
    })
  })

  it('壊れた JSON でも既定値で起動できる', async () => {
    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{ not json', 'utf8')

    expect(await new JsonSettingsRepository(broken, 'ja').load()).toEqual(defaultSettings('ja'))
  })

  it('壊れた設定ファイルは保存する前に退避する（保存先の指定を黙って失わない）', async () => {
    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{ "storageDir": "/Users/me/Meet', 'utf8')

    await new JsonSettingsRepository(broken, 'ja').save({ audio: { bitrateKbps: 64 } })

    const [quarantined] = (await readdir(dir)).filter((name) => name.startsWith('broken.json.unreadable-'))
    expect(await readFile(join(dir, quarantined ?? ''), 'utf8')).toBe('{ "storageDir": "/Users/me/Meet')
  })

  it('object でない JSON も既定値で起動し、保存前に退避する', async () => {
    const odd = join(dir, 'odd.json')
    await writeFile(odd, 'null', 'utf8')

    const repository = new JsonSettingsRepository(odd, 'ja')
    expect(await repository.load()).toEqual(defaultSettings('ja'))
    await repository.save({ storageDir: '/Users/me/Meetings' })

    expect((await readdir(dir)).some((name) => name.startsWith('odd.json.unreadable-'))).toBe(true)
  })

  it('知らないキーを保存で消さない（新しい版の設定を古い版で壊さない）', async () => {
    const newer = join(dir, 'newer.json')
    await writeFile(
      newer,
      JSON.stringify({ storageDir: '/old', futureGroup: { enabled: true }, audio: { futureKey: 1 } }),
      'utf8'
    )

    await new JsonSettingsRepository(newer, 'ja').save({ storageDir: '/new' })

    expect(JSON.parse(await readFile(newer, 'utf8'))).toMatchObject({
      storageDir: '/new',
      futureGroup: { enabled: true },
      audio: { futureKey: 1 }
    })
  })

  it('形式の番号（schemaVersion）を書き込む', async () => {
    await new JsonSettingsRepository(filePath, 'ja').save({ storageDir: '/Users/me/Meetings' })

    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ schemaVersion: 1 })
  })

  it('新しい版が書いた設定は読めるが、上書きは断る（古い版で壊さない）', async () => {
    const newer = join(dir, 'newer.json')
    const content = JSON.stringify({ schemaVersion: 2, storageDir: '/Users/me/Meetings' })
    await writeFile(newer, content, 'utf8')

    const repository = new JsonSettingsRepository(newer, 'ja')
    expect((await repository.load()).storageDir).toBe('/Users/me/Meetings')
    await expect(repository.save({ storageDir: '/elsewhere' })).rejects.toThrow('storageNewerVersion')
    expect(await readFile(newer, 'utf8')).toBe(content)
  })

  it('数値でない番号は理解できないものとして上書きを断る', async () => {
    const odd = join(dir, 'odd-version.json')
    await writeFile(odd, JSON.stringify({ schemaVersion: '2' }), 'utf8')

    await expect(new JsonSettingsRepository(odd, 'ja').save({ storageDir: '/x' })).rejects.toThrow(
      'storageNewerVersion'
    )
  })

  it('中断で壊れないよう一時ファイル経由で置換する', async () => {
    await new JsonSettingsRepository(filePath, 'ja').save({ storageDir: '/Users/me/Meetings' })

    const raw = await readFile(filePath, 'utf8')
    expect(JSON.parse(raw)).toMatchObject({ storageDir: '/Users/me/Meetings' })
  })
})

describe('SettingsStorageLocator', () => {
  it('設定された保存先を返す', async () => {
    const repository = new JsonSettingsRepository(filePath, 'ja')
    await repository.save({ storageDir: '/Users/me/Meetings' })

    expect(await new SettingsStorageLocator(repository).root()).toBe('/Users/me/Meetings')
  })

  it('未設定なら設定画面へ誘導する', async () => {
    await expect(new SettingsStorageLocator(new JsonSettingsRepository(filePath, 'ja')).root()).rejects.toThrow(
      'storageNotConfigured'
    )
  })
})
