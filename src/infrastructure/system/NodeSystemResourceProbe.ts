import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { freemem, totalmem } from 'node:os'
import { promisify } from 'node:util'
import type { SystemResourcePort } from '@application/ports'
import type { MemorySnapshot } from '@domain/MemoryGuard'

const run = promisify(execFile)

/** 空きから除くページ。カーネルが固定している分と、圧縮器が占有している分。 */
const UNAVAILABLE_LINES = ['Pages wired down', 'Pages occupied by compressor'] as const

/**
 * `vm_stat` の出力から、大きな確保に回せるバイト数を求める。
 *
 * 「総量 − 手放せないページ」で数える。手放せないのは wired（カーネルが固定）と
 * compressor が占有中のページだけで、active・inactive な匿名ページは大きな要求が
 * 来れば macOS が圧縮して回すため、空きとして数えてよい。
 *
 * free と inactive を足すやり方も試したが、この機体では 4.9GB となり、
 * node-llama-cpp 自身が 12.7GB 使えると判断して実際に動く状況で要約を拒んだ。
 * 本式は同一時点で 60.8%、OS が jetsam の判断に使う kern.memorystatus_level は 59%
 * と一致する。誤検知で要約を壊さないために、OS 自身の見立てに合わせている。
 *
 * `os.freemem()` を使わないのも同じ理由で、macOS では純粋な free ページしか数えない。
 *
 * 解析できなければ undefined を返す。空き 0 と取り違えると全ステップが止まるため、
 * 「分からない」と「無い」は区別する。
 */
export const parseVmStat = (output: string, totalBytes: number): number | undefined => {
  const pageSize = Number(/page size of (\d+) bytes/.exec(output)?.[1])
  if (!Number.isFinite(pageSize) || pageSize <= 0) return undefined

  let pages = 0
  let matched = false

  for (const label of UNAVAILABLE_LINES) {
    const found = new RegExp(`^${label}:\\s+(\\d+)\\.`, 'm').exec(output)
    if (!found?.[1]) continue
    pages += Number(found[1])
    matched = true
  }

  if (!matched) return undefined

  // 総量とページ数は出どころが違うため、理屈の上ではずれ得る。
  return Math.max(0, totalBytes - pages * pageSize)
}

/**
 * OS のメモリ状況とファイルサイズを測る。
 *
 * `electron` を import しない。utilityProcess（electron API を持たない Node 環境）から
 * 使うため。
 */
export class NodeSystemResourceProbe implements SystemResourcePort {
  async memory(): Promise<MemorySnapshot> {
    const totalBytes = totalmem()
    return { totalBytes, availableBytes: await available(totalBytes) }
  }

  async fileSize(path: string): Promise<number | undefined> {
    try {
      return (await stat(path)).size
    } catch {
      return undefined
    }
  }
}

/**
 * vm_stat が使えなければ os.freemem() に退く。
 * 過小に見えるぶんガードは厳しくなるが、測定不能を理由に処理を止めるよりはよい。
 */
const available = async (totalBytes: number): Promise<number> => {
  try {
    const { stdout } = await run('/usr/bin/vm_stat')
    return parseVmStat(stdout, totalBytes) ?? freemem()
  } catch {
    return freemem()
  }
}
