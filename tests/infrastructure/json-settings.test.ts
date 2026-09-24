import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  JsonSettingsRepository,
  SettingsStorageLocator
} from '@infrastructure/settings/JsonSettingsRepository'
import { defaultSettings } from '@domain/Settings'

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
    expect(await new JsonSettingsRepository(filePath).load()).toEqual(defaultSettings())
  })

  it('保存した設定を別インスタンスから読み戻せる', async () => {
    await new JsonSettingsRepository(filePath).save({ storageDir: '/Users/me/Meetings' })

    expect((await new JsonSettingsRepository(filePath).load()).storageDir).toBe(
      '/Users/me/Meetings'
    )
  })

  it('部分更新で他の設定を失わない', async () => {
    const repository = new JsonSettingsRepository(filePath)
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

    const settings = await new JsonSettingsRepository(legacy).load()
    expect(settings.storageDir).toBe('/old')
    expect(settings.audio).toEqual(defaultSettings().audio)
  })

  it('壊れた JSON でも既定値で起動できる', async () => {
    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{ not json', 'utf8')

    expect(await new JsonSettingsRepository(broken).load()).toEqual(defaultSettings())
  })

  it('壊れた設定ファイルは保存する前に退避する（保存先の指定を黙って失わない）', async () => {
    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{ "storageDir": "/Users/me/Meet', 'utf8')

    await new JsonSettingsRepository(broken).save({ audio: { bitrateKbps: 64 } })

    const [quarantined] = (await readdir(dir)).filter((name) =>
      name.startsWith('broken.json.unreadable-')
    )
    expect(await readFile(join(dir, quarantined ?? ''), 'utf8')).toBe(
      '{ "storageDir": "/Users/me/Meet'
    )
  })

  it('object でない JSON も既定値で起動し、保存前に退避する', async () => {
    const odd = join(dir, 'odd.json')
    await writeFile(odd, 'null', 'utf8')

    const repository = new JsonSettingsRepository(odd)
    expect(await repository.load()).toEqual(defaultSettings())
    await repository.save({ storageDir: '/Users/me/Meetings' })

    expect((await readdir(dir)).some((name) => name.startsWith('odd.json.unreadable-'))).toBe(
      true
    )
  })

  it('知らないキーを保存で消さない（新しい版の設定を古い版で壊さない）', async () => {
    const newer = join(dir, 'newer.json')
    await writeFile(
      newer,
      JSON.stringify({ storageDir: '/old', futureGroup: { enabled: true }, audio: { futureKey: 1 } }),
      'utf8'
    )

    await new JsonSettingsRepository(newer).save({ storageDir: '/new' })

    expect(JSON.parse(await readFile(newer, 'utf8'))).toMatchObject({
      storageDir: '/new',
      futureGroup: { enabled: true },
      audio: { futureKey: 1 }
    })
  })

  it('形式の番号（schemaVersion）を書き込む', async () => {
    await new JsonSettingsRepository(filePath).save({ storageDir: '/Users/me/Meetings' })

    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ schemaVersion: 1 })
  })

  it('新しい版が書いた設定は読めるが、上書きは断る（古い版で壊さない）', async () => {
    const newer = join(dir, 'newer.json')
    const content = JSON.stringify({ schemaVersion: 2, storageDir: '/Users/me/Meetings' })
    await writeFile(newer, content, 'utf8')

    const repository = new JsonSettingsRepository(newer)
    expect((await repository.load()).storageDir).toBe('/Users/me/Meetings')
    await expect(repository.save({ storageDir: '/elsewhere' })).rejects.toThrow(
      'アプリを更新してください'
    )
    expect(await readFile(newer, 'utf8')).toBe(content)
  })

  it('数値でない番号は理解できないものとして上書きを断る', async () => {
    const odd = join(dir, 'odd-version.json')
    await writeFile(odd, JSON.stringify({ schemaVersion: '2' }), 'utf8')

    await expect(new JsonSettingsRepository(odd).save({ storageDir: '/x' })).rejects.toThrow(
      'アプリを更新してください'
    )
  })

  it('中断で壊れないよう一時ファイル経由で置換する', async () => {
    await new JsonSettingsRepository(filePath).save({ storageDir: '/Users/me/Meetings' })

    const raw = await readFile(filePath, 'utf8')
    expect(JSON.parse(raw)).toMatchObject({ storageDir: '/Users/me/Meetings' })
  })
})

describe('SettingsStorageLocator', () => {
  it('設定された保存先を返す', async () => {
    const repository = new JsonSettingsRepository(filePath)
    await repository.save({ storageDir: '/Users/me/Meetings' })

    expect(await new SettingsStorageLocator(repository).root()).toBe('/Users/me/Meetings')
  })

  it('未設定なら設定画面へ誘導する', async () => {
    await expect(
      new SettingsStorageLocator(new JsonSettingsRepository(filePath)).root()
    ).rejects.toThrow('保存先が設定されていません。設定画面から保存先を選んでください。')
  })
})
