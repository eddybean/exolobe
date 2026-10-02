import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NodeSystemResourceProbe, parseVmStat } from '@infrastructure/system/NodeSystemResourceProbe'

/** 実機の vm_stat 出力（16GB / ページ 16384 バイト）。 */
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    28213.
Pages active:                                 287293.
Pages inactive:                               285303.
Pages speculative:                              1488.
Pages throttled:                                   0.
Pages wired down:                             128010.
Pages purgeable:                                2796.
"Translation faults":                      583589307.
Pages copy-on-write:                        36812210.
File-backed pages:                            170326.
Anonymous pages:                              403758.
Pages stored in compressor:                   737092.
Pages occupied by compressor:                 283459.
`

/** 16GB 機の総容量。VM_STAT と同じ時点のもの。 */
const TOTAL = 1_048_576 * 16_384

describe('parseVmStat', () => {
  /**
   * 空きは「総量 − 手放せないページ」で求める。手放せないのは wired（カーネルが
   * 固定）と compressor が占有中のページだけ。active な匿名ページも、大きな要求が
   * 来れば macOS が圧縮して回すため、空きとして数えてよい。
   *
   * この数え方の妥当性は kern.memorystatus_level（OS 自身が jetsam の判断に使う
   * 空き率）と突き合わせて確認した。同一時点で本式が 60.8%、OS が 59% と一致する。
   */
  it('wired と compressor 以外を空きとして数える', () => {
    // (1,048,576 − 128,010 − 283,459) ページ。
    expect(parseVmStat(VM_STAT, TOTAL)).toBe(637_107 * 16_384)
  })

  it('active や inactive が増減しても空きは変わらない', () => {
    const busier = VM_STAT.replace(
      'Pages active:                                 287293.',
      'Pages active:                                 987293.'
    )

    expect(parseVmStat(busier, TOTAL)).toBe(parseVmStat(VM_STAT, TOTAL))
  })

  it('wired が増えると空きが減る', () => {
    const busier = VM_STAT.replace(
      'Pages wired down:                             128010.',
      'Pages wired down:                             228010.'
    )

    expect(parseVmStat(busier, TOTAL)).toBe(parseVmStat(VM_STAT, TOTAL)! - 100_000 * 16_384)
  })

  it('ページサイズが違っても正しく換算する', () => {
    const output = `Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages wired down:                               1000.
Pages occupied by compressor:                   1000.
`

    expect(parseVmStat(output, 10_000 * 4_096)).toBe(8_000 * 4_096)
  })

  it('読み取れない出力では undefined を返す', () => {
    // 解析できないことを空き 0 と誤って伝えると、すべての処理が止まる。
    expect(parseVmStat('', TOTAL)).toBeUndefined()
    expect(parseVmStat('なにか別の出力', TOTAL)).toBeUndefined()
  })

  it('負の値は返さない', () => {
    // 総量とページ数の出どころが違うため、理屈の上ではずれ得る。
    expect(parseVmStat(VM_STAT, 1_000)).toBe(0)
  })
})

describe('NodeSystemResourceProbe', () => {
  const probe = new NodeSystemResourceProbe()

  it('実機の空き容量を総量の範囲で返す', async () => {
    const snapshot = await probe.memory()

    expect(snapshot.totalBytes).toBe(totalmem())
    expect(snapshot.availableBytes).toBeGreaterThan(0)
    expect(snapshot.availableBytes).toBeLessThanOrEqual(snapshot.totalBytes)
  })

  it('macOS 以外では vm_stat を呼ばず、OS の「利用可能」（os.freemem）をそのまま使う', async () => {
    let called = false
    const windows = new NodeSystemResourceProbe({
      platform: 'win32',
      vmStat: async () => {
        called = true
        return ''
      }
    })

    const snapshot = await windows.memory()

    expect(called).toBe(false)
    expect(snapshot.availableBytes).toBeGreaterThan(0)
    expect(snapshot.availableBytes).toBeLessThanOrEqual(snapshot.totalBytes)
  })

  it('macOS では vm_stat の出力から求める', async () => {
    const mac = new NodeSystemResourceProbe({ platform: 'darwin', vmStat: async () => VM_STAT })

    const snapshot = await mac.memory()

    expect(snapshot.availableBytes).toBe(parseVmStat(VM_STAT, snapshot.totalBytes))
  })

  describe('fileSize', () => {
    let dir: string

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'omr-probe-'))
    })
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    it('ファイルの大きさを返す', async () => {
      const path = join(dir, 'model.gguf')
      await writeFile(path, Buffer.alloc(1_024))

      expect(await probe.fileSize(path)).toBe(1_024)
    })

    it('存在しないファイルでは undefined を返す', async () => {
      expect(await probe.fileSize(join(dir, 'missing.gguf'))).toBeUndefined()
    })
  })
})
