import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * 旧名 Duoscribe の userData を Exolobe へ移す使い捨てのスクリプト。
 * アプリ名が変わると Electron の userData も変わり、声紋帳（voiceprints.json）のような
 * 再生成できないデータが旧ディレクトリに取り残されるため。HOME を一時ディレクトリに
 * 向けて、実データには触れずに確かめる。
 */
const SCRIPT = join(__dirname, '../../scripts/migrate-from-duoscribe.sh')

let home: string
let appSupport: string

const run = (): ReturnType<typeof spawnSync> =>
  spawnSync('bash', [SCRIPT], { env: { ...process.env, HOME: home }, encoding: 'utf8' })

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'migrate-duoscribe-'))
  appSupport = join(home, 'Library', 'Application Support')
  mkdirSync(appSupport, { recursive: true })
})

describe('migrate-from-duoscribe.sh', () => {
  it('Duoscribe の userData を中身ごと Exolobe へ移す', () => {
    mkdirSync(join(appSupport, 'Duoscribe', 'models'), { recursive: true })
    writeFileSync(join(appSupport, 'Duoscribe', 'voiceprints.json'), '[]')

    const result = run()

    expect(result.status).toBe(0)
    expect(existsSync(join(appSupport, 'Duoscribe'))).toBe(false)
    expect(readFileSync(join(appSupport, 'Exolobe', 'voiceprints.json'), 'utf8')).toBe('[]')
    expect(existsSync(join(appSupport, 'Exolobe', 'models'))).toBe(true)
  })

  it('移行先が既にあれば、どちらにも触れずに失敗する', () => {
    mkdirSync(join(appSupport, 'Duoscribe'))
    writeFileSync(join(appSupport, 'Duoscribe', 'settings.json'), 'old')
    mkdirSync(join(appSupport, 'Exolobe'))
    writeFileSync(join(appSupport, 'Exolobe', 'settings.json'), 'new')

    const result = run()

    expect(result.status).not.toBe(0)
    expect(readFileSync(join(appSupport, 'Duoscribe', 'settings.json'), 'utf8')).toBe('old')
    expect(readFileSync(join(appSupport, 'Exolobe', 'settings.json'), 'utf8')).toBe('new')
  })

  it('旧ディレクトリが無ければ何もせずに成功する', () => {
    const result = run()

    expect(result.status).toBe(0)
    expect(existsSync(join(appSupport, 'Exolobe'))).toBe(false)
  })
})
