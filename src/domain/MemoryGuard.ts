import { formatBytes } from '@domain/ModelCatalog'

/**
 * 重い推論に入る前のメモリ判定。
 *
 * 要約は 5GB を超えるモデルを一度にメモリへ載せる。空きを見ずに始めると、
 * macOS が圧縮とスワップに追われて会議アプリごと固まる。ここで先に断ることで、
 * 失敗を「扱えるエラー」に変え、OS の巻き添えを避ける。
 *
 * 判定は純粋な計算に閉じてある。実際の空き容量の取得は SystemResourcePort の仕事。
 */

/** OS にどれだけ余白を残すか。利用者が設定で選ぶ。 */
export type MemoryProtection = 'conservative' | 'standard' | 'off'

export const MEMORY_PROTECTIONS: readonly MemoryProtection[] = ['conservative', 'standard', 'off']

export const isMemoryProtection = (value: unknown): value is MemoryProtection =>
  MEMORY_PROTECTIONS.includes(value as MemoryProtection)

export interface MemorySnapshot {
  readonly totalBytes: number
  /** 今すぐ使える量。測定できなかった場合は NaN。 */
  readonly availableBytes: number
}

export interface MemoryDemand {
  readonly bytes: number
  /** 利用者に見せるステップ名。「要約」「文字起こし」。 */
  readonly label: string
}

const GB = 1_024 ** 3

/**
 * OS と他アプリのために空けておく量。
 *
 * 総量比だけで決めると 8GB 機で余白が小さくなりすぎ、比を使わないと 64GB 機で
 * 過剰に厳しくなる。下限と比率の大きい方を採る。
 */
export const headroomBytes = (protection: MemoryProtection, totalBytes: number): number => {
  switch (protection) {
    case 'off':
      return 0
    case 'standard':
      return Math.max(1 * GB, totalBytes * 0.1)
    case 'conservative':
      return Math.max(3 * GB, totalBytes * 0.2)
  }
}

/**
 * 実測（node-llama-cpp の GgufInsights、Gemma 4 E4B QAT q4_0 / Apple Silicon）に基づく係数。
 *
 *   モデル       : ファイル 5,154,941,280 に対し実所要 5,689,620,800 → 約 1.10 倍
 *   コンテキスト : 8K で 819,697,152 / 32K で 1,272,780,288 → 約 18.4KB/トークン ＋ 固定 0.62GB
 *
 * 見積もりが実測を下回るとガードが素通りするため、いずれも安全側へ丸めてある。
 * モデルを変えれば係数はずれるが、桁を外さない粗い見積もりで目的は足りる。
 */
const MODEL_OVERHEAD_RATIO = 1.15
const CONTEXT_FIXED_BYTES = 0.75 * GB
const KV_BYTES_PER_TOKEN = 19_456

export const estimateSummarizationBytes = (params: {
  modelFileBytes: number
  contextSize: number
}): number =>
  params.modelFileBytes * MODEL_OVERHEAD_RATIO +
  CONTEXT_FIXED_BYTES +
  params.contextSize * KV_BYTES_PER_TOKEN

/**
 * 文字起こしの所要メモリ。
 *
 * whisper-cli は別プロセスだが、メモリは同じ OS から取るので判定の対象になる。
 * 要約と比べれば一桁小さく、実際に弾かれるのは相当逼迫した状況だけになる。
 */
const WHISPER_OVERHEAD_RATIO = 1.5
const WHISPER_COMPUTE_BYTES = 0.5 * GB

export const estimateTranscriptionBytes = (params: { modelFileBytes: number }): number =>
  params.modelFileBytes * WHISPER_OVERHEAD_RATIO + WHISPER_COMPUTE_BYTES

/** 足りなければ利用者向けの理由を返す。足りていれば undefined。 */
export const insufficientMemory = (params: {
  snapshot: MemorySnapshot
  demand: MemoryDemand
  protection: MemoryProtection
}): string | undefined => {
  const { snapshot, demand, protection } = params

  if (protection === 'off') return undefined
  // 測れなかったことを理由に処理を拒むと、ガードが機能低下そのものになる。
  if (!Number.isFinite(snapshot.availableBytes)) return undefined

  const required = demand.bytes + headroomBytes(protection, snapshot.totalBytes)
  if (snapshot.availableBytes >= required) return undefined

  return [
    `メモリが不足しているため${demand.label}を実行しませんでした`,
    `（必要 約${formatBytes(required)} / 空き 約${formatBytes(snapshot.availableBytes)}）。`,
    '他のアプリを終了してから再実行してください。',
    '設定の「メモリ保護」で判定の厳しさを変えられます。'
  ].join('')
}
