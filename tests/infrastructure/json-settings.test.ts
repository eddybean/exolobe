import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
