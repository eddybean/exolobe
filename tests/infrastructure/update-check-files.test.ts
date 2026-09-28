import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CaskroomInstallSource } from '@infrastructure/update/CaskroomInstallSource'
import { FileUpdateCheckStore } from '@infrastructure/update/FileUpdateCheckStore'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omr-update-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('CaskroomInstallSource', () => {
  it('Caskroom にこのアプリがあれば Homebrew で入れたとみなす', async () => {
    await mkdir(join(dir, 'intel', 'exolobe'), { recursive: true })
    const source = new CaskroomInstallSource([join(dir, 'arm', 'exolobe'), join(dir, 'intel', 'exolobe')])

    expect(await source.detect()).toBe('homebrew')
  })

  it('どこにも無ければ DMG から入れたとみなす', async () => {
    expect(await new CaskroomInstallSource([join(dir, 'exolobe')]).detect()).toBe('dmg')
  })
})

describe('FileUpdateCheckStore', () => {
  it('まだ無ければ undefined を返す', async () => {
    expect(await new FileUpdateCheckStore(join(dir, 'update-check.json')).load()).toBeUndefined()
  })

  it('確認の記録を保存して読み戻せる', async () => {
    const store = new FileUpdateCheckStore(join(dir, 'update-check.json'))
    const record = {
      checkedAt: new Date('2026-09-28T03:00:00Z'),
      latest: { version: '0.3.0', pageUrl: 'https://github.com/eddybean/exolobe/releases/tag/v0.3.0' }
    }

    await store.save(record)
    expect(await store.load()).toEqual(record)

    await store.save({ checkedAt: record.checkedAt, latest: undefined })
    expect(await store.load()).toEqual({ checkedAt: record.checkedAt, latest: undefined })
  })

  it('読めない中身は無いものとして扱う（次に確かめ直すだけで済む）', async () => {
    const path = join(dir, 'update-check.json')
    await writeFile(path, '{"checkedAt":"yesterday"}')

    expect(await new FileUpdateCheckStore(path).load()).toBeUndefined()
  })

  it('GitHub 以外を指す配布ページは読まない（開くのは main で、書き換えられたファイルを信じない）', async () => {
    const path = join(dir, 'update-check.json')
    await writeFile(
      path,
      JSON.stringify({
        checkedAt: '2026-09-28T03:00:00.000Z',
        latest: { version: '0.3.0', pageUrl: 'https://example.com/exolobe.dmg' }
      })
    )

    expect(await new FileUpdateCheckStore(path).load()).toBeUndefined()
  })
})
