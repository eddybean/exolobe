import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MicUsageProbe } from '../../src/infrastructure/mic/MicUsageProbe'
import { parseMicUsageLine } from '../../src/infrastructure/mic/micUsageProtocol'
import { resolveMicWatchBinary } from '../../src/infrastructure/mic/resolveMicWatchBinary'
import { notMacOS } from '../platform'

describe('parseMicUsageLine', () => {
  it('1 と 0 を使用状態として読む', () => {
    expect(parseMicUsageLine('1')).toBe(true)
    expect(parseMicUsageLine('0')).toBe(false)
  })

  it('改行や空白が付いていても読む', () => {
    expect(parseMicUsageLine(' 1 ')).toBe(true)
  })

  it('想定外の行は無視する（ログ等が混ざっても壊れない）', () => {
    expect(parseMicUsageLine('')).toBeUndefined()
    expect(parseMicUsageLine('starting micwatch')).toBeUndefined()
  })
})

describe('resolveMicWatchBinary', () => {
  it('配布版は Resources/bin の同梱物を使う', () => {
    const path = resolveMicWatchBinary({
      packaged: true,
      resourcesPath: '/Apps/Meeting Recorder.app/Contents/Resources',
      cwd: '/repo',
      exists: () => true
    })

    expect(path).toBe(join('/Apps/Meeting Recorder.app/Contents/Resources', 'bin', 'micwatch'))
  })

  it('開発時はリポジトリの resources/bin を使う', () => {
    const path = resolveMicWatchBinary({
      packaged: false,
      resourcesPath: '/ignored',
      cwd: '/repo',
      exists: () => true
    })

    expect(path).toBe(join('/repo', 'resources', 'bin', 'micwatch'))
  })

  it('同梱物が無ければ undefined を返す（機能だけ無効になる）', () => {
    const path = resolveMicWatchBinary({
      packaged: false,
      resourcesPath: '/ignored',
      cwd: '/repo',
      exists: () => false
    })

    expect(path).toBeUndefined()
  })
})

/** micwatch の代役。実際に spawn して、行の組み立てと終了時の扱いを確かめる。 */
describe.skipIf(notMacOS)('MicUsageProbe', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'omr-micwatch-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const fakeBinary = async (script: string): Promise<string> => {
    const path = join(dir, 'micwatch')
    await writeFile(path, `#!/bin/sh\n${script}\n`)
    await chmod(path, 0o755)
    return path
  }

  const collect = async (probe: MicUsageProbe, count: number): Promise<boolean[]> => {
    const seen: boolean[] = []
    return new Promise((resolve) => {
      probe.onChange((inUse) => {
        seen.push(inUse)
        if (seen.length === count) resolve(seen)
      })
      probe.start()
    })
  }

  it('届いた行を使用状態として流す', async () => {
    // 1 度の write に 2 行が入っていても、行ごとに分けて届く。
    const probe = new MicUsageProbe(await fakeBinary('printf "1\\n0\\n"; sleep 5'))

    await expect(collect(probe, 2)).resolves.toEqual([true, false])
    probe.stop()
  })

  it('落ちたら「使われていない」に倒す', async () => {
    // 使用中のまま固定されると、会議が終わっても録音を促し続けてしまう。
    const probe = new MicUsageProbe(await fakeBinary('printf "1\\n"'))

    await expect(collect(probe, 2)).resolves.toEqual([true, false])
  })

  it('同梱物が無ければ動かない', () => {
    const probe = new MicUsageProbe(undefined)

    expect(probe.available).toBe(false)
    expect(() => probe.start()).not.toThrow()
  })
})
