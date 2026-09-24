import { join } from 'node:path'
import type { VoiceprintRepositoryPort } from '@application/ports'
import { isVoiceVector, type VoiceSource, type Voiceprint } from '@domain/Voiceprint'
import type { StorageLocator } from './FileRecordingStore'
import { readStoredJson, replaceStoredJson, writeJsonAtomic, type StoredJson } from './jsonFile'

export type { StorageLocator } from './FileRecordingStore'

const VOICEPRINTS_FILE = 'voiceprints.json'

/** JSON に Float32Array は無いので数値配列で持ち、読むときに戻す。 */
interface VoiceprintRecord {
  name: string
  vector: number[]
  sources: { key: string; vector: number[] }[]
  modelKey: string
  updatedAt: string
}

const toRecord = (voiceprint: Voiceprint): VoiceprintRecord => ({
  name: voiceprint.name,
  vector: Array.from(voiceprint.vector),
  sources: voiceprint.sources.map((source) => ({
    key: source.key,
    vector: Array.from(source.vector)
  })),
  modelKey: voiceprint.modelKey,
  updatedAt: voiceprint.updatedAt
})

const toSource = (value: unknown): VoiceSource | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { key?: unknown; vector?: unknown }
  if (typeof candidate.key !== 'string' || !isVoiceVector(candidate.vector)) return undefined
  return { key: candidate.key, vector: Float32Array.from(candidate.vector) }
}

const toVoiceprint = (value: unknown): Voiceprint | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<VoiceprintRecord>
  if (
    typeof candidate.name !== 'string' ||
    !isVoiceVector(candidate.vector) ||
    !Array.isArray(candidate.sources) ||
    typeof candidate.modelKey !== 'string' ||
    typeof candidate.updatedAt !== 'string'
  ) {
    return undefined
  }

  const sources = candidate.sources.flatMap((entry) => {
    const source = toSource(entry)
    return source ? [source] : []
  })
  // 出所を持たない声紋は、名前を付け直しても取り消せない。持たせられない以上、
  // 読み込みの時点で無かったことにする（覚え直せばまた作られる）。
  if (sources.length === 0) return undefined

  return {
    name: candidate.name,
    vector: Float32Array.from(candidate.vector),
    sources,
    modelKey: candidate.modelKey,
    updatedAt: candidate.updatedAt
  }
}

const nameOf = (entry: unknown): unknown =>
  typeof entry === 'object' && entry !== null ? (entry as { name?: unknown }).name : undefined

/**
 * 声紋帳を保存先ルートの voiceprints.json にまとめて保存する。
 *
 * 保存先に置くのは、これが録音ライブラリと一体のものだから。別のマシンへ
 * ライブラリを移したときに、そこで呼んでいた名前も一緒に付いてくる。
 * 意味検索の索引（userData 側）と違い再生成できないので、キャッシュとは扱わない。
 */
export class FileVoiceprintRepository implements VoiceprintRepositoryPort {
  constructor(private readonly locator: StorageLocator) {}

  async list(): Promise<Voiceprint[]> {
    const { stored } = await this.read()
    if (stored.kind !== 'ok') return []

    return stored.value.flatMap((entry) => {
      const voiceprint = toVoiceprint(entry)
      return voiceprint ? [voiceprint] : []
    })
  }

  async put(voiceprint: Voiceprint): Promise<void> {
    await this.rewrite((entries) => [
      ...entries.filter((entry) => nameOf(entry) !== voiceprint.name),
      toRecord(voiceprint)
    ])
  }

  async remove(name: string): Promise<void> {
    await this.rewrite((entries) => entries.filter((entry) => nameOf(entry) !== name))
  }

  async clear(): Promise<void> {
    // 利用者が「全部消す」を選んだのだから、読めなかった要素も含めて消す。
    // 声紋は生体情報なので、退避して残すこともしない。
    await writeJsonAtomic(join(await this.locator.root(), VOICEPRINTS_FILE), [])
  }

  /**
   * 読んだ生の要素に対して差し替える。list() を経由すると、読めない要素や
   * 知らないキー（新しい版が書いたもの）が書き戻しで消える（ADR-035）。
   */
  private async rewrite(change: (entries: readonly unknown[]) => unknown[]): Promise<void> {
    const { path, stored } = await this.read()
    await replaceStoredJson(path, stored, change(stored.kind === 'ok' ? stored.value : []))
  }

  private async read(): Promise<{ path: string; stored: StoredJson<unknown[]> }> {
    const path = join(await this.locator.root(), VOICEPRINTS_FILE)
    return { path, stored: await readStoredJson(path, Array.isArray) }
  }
}
