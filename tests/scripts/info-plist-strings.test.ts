import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { notMacOS } from '../platform'

/**
 * 許可ダイアログの文言（ADR-043）。
 *
 * macOS は Info.plist のキーがあるときだけ許可を求め、表示する文言は .lproj の
 * InfoPlist.strings から UI の言語で引く。基底の Info.plist（electron-builder.yml）と
 * 英語の InfoPlist.strings、開発用 Electron.app へのパッチの 3 か所に同じ文言が要るので、
 * 食い違いをここで止める。
 */
const ROOT = join(__dirname, '../..')
const USAGE_KEYS = [
  'NSAudioCaptureUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSCalendarsFullAccessUsageDescription'
]

/** .strings は plutil が読める（テストは macOS 前提）。 */
const readStrings = (path: string): Record<string, string> =>
  JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8' }))

const lproj = (language: string): Record<string, string> =>
  readStrings(join(ROOT, 'build/lproj', `${language}.lproj`, 'InfoPlist.strings'))

/** extendInfo の 1 行 1 キーの値を読む。YAML の読み取りを持ち込むほどの構造ではない。 */
const extendInfo = (): Record<string, string> => {
  const yml = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
  return Object.fromEntries(USAGE_KEYS.map((key) => [key, new RegExp(`^\\s+${key}: (.+)$`, 'm').exec(yml)?.[1] ?? '']))
}

describe.skipIf(notMacOS)('InfoPlist.strings', () => {
  it('英語と日本語の両方が、使う権限の説明をすべて持つ', () => {
    for (const language of ['en', 'ja']) {
      expect(Object.keys(lproj(language)).sort()).toEqual([...USAGE_KEYS].sort())
    }
  })

  it('基底の Info.plist は英語の文言と一致する（対応していない言語の人に出る）', () => {
    expect(extendInfo()).toEqual(lproj('en'))
  })

  it('日本語の文言は英語と別に訳されている', () => {
    const ja = lproj('ja')
    for (const key of USAGE_KEYS) expect(ja[key]).toMatch(/[぀-ヿ]/)
  })
})

describe.skipIf(notMacOS)('開発用 Electron.app へのパッチ', () => {
  it('基底に英語の文言を入れ、各言語の InfoPlist.strings を置く', () => {
    const app = join(mkdtempSync(join(tmpdir(), 'omr-plist-')), 'Electron.app')
    mkdirSync(join(app, 'Contents/Resources'), { recursive: true })
    const plist = join(app, 'Contents/Info.plist')
    writeFileSync(
      plist,
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict/></plist>\n'
    )

    const result = spawnSync('bash', [join(ROOT, 'scripts/patch-dev-electron.sh')], {
      cwd: ROOT,
      env: { ...process.env, OMR_DEV_ELECTRON_APP: app },
      encoding: 'utf8'
    })

    expect(result.status).toBe(0)
    const patched = readStrings(plist)
    for (const key of USAGE_KEYS) expect(patched[key]).toBe(lproj('en')[key])
    for (const language of ['en', 'ja']) {
      expect(readStrings(join(app, 'Contents/Resources', `${language}.lproj/InfoPlist.strings`))).toEqual(
        lproj(language)
      )
    }
  })
})
