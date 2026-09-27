import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * 旧名 Duoscribe の userData を Exolobe へ移す使い捨てのスクリプト。
 * アプリ名が変わると Electron の userData も変わり、設定・数 GB のモデル・意味検索の索引が
 * 旧ディレクトリに取り残されるため。HOME を一時ディレクトリに向けて、実データには触れずに確かめる。
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

const writeSettings = (dir: string, settings: unknown): void =>
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2))

const readSettings = (dir: string): unknown =>
  JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))

describe('migrate-from-duoscribe.sh', () => {
  it('Duoscribe の userData を中身ごと Exolobe へ移す', () => {
    mkdirSync(join(appSupport, 'Duoscribe', 'models'), { recursive: true })
    writeFileSync(join(appSupport, 'Duoscribe', 'models', 'installed.json'), '{}')

    const result = run()

    expect(result.status).toBe(0)
    expect(existsSync(join(appSupport, 'Duoscribe'))).toBe(false)
    expect(readFileSync(join(appSupport, 'Exolobe', 'models', 'installed.json'), 'utf8')).toBe('{}')
  })

  // モデルの場所は設定画面で任意のパスを選べるため、settings.json にはフルパスで入っている。
  // 移しただけだと、どのモデルも「未取得」に見える。
  it('設定の中の、旧ディレクトリを指すモデルのパスを移行先に書き換える', () => {
    const legacy = join(appSupport, 'Duoscribe')
    mkdirSync(join(legacy, 'models'), { recursive: true })
    writeSettings(legacy, {
      storageDir: '/Users/someone/Documents/meetings',
      transcription: { modelPath: join(legacy, 'models', 'ggml.bin') },
      search: { modelPath: '/Volumes/External/models/bge-m3.gguf' }
    })

    const result = run()

    expect(result.status).toBe(0)
    expect(readSettings(join(appSupport, 'Exolobe'))).toEqual({
      storageDir: '/Users/someone/Documents/meetings',
      transcription: { modelPath: join(appSupport, 'Exolobe', 'models', 'ggml.bin') },
      search: { modelPath: '/Volumes/External/models/bge-m3.gguf' }
    })
  })

  it('移動だけ済んでいる場合も、設定の中のパスを書き換える', () => {
    const current = join(appSupport, 'Exolobe')
    mkdirSync(current)
    writeSettings(current, {
      summarization: { modelPath: join(appSupport, 'Duoscribe', 'models', 'gemma.gguf') }
    })

    const result = run()

    expect(result.status).toBe(0)
    expect(readSettings(current)).toEqual({
      summarization: { modelPath: join(current, 'models', 'gemma.gguf') }
    })
  })

  it('名前が旧ディレクトリで始まるだけの別のディレクトリは書き換えない', () => {
    const current = join(appSupport, 'Exolobe')
    mkdirSync(current)
    const lookalike = join(appSupport, 'Duoscribe-backup', 'models', 'ggml.bin')
    writeSettings(current, { transcription: { modelPath: lookalike } })

    run()

    expect(readSettings(current)).toEqual({ transcription: { modelPath: lookalike } })
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
