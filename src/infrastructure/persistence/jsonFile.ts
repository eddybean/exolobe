import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { AppError } from '@domain/errors'

export class StorageError extends AppError {}

export const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    // 未作成・壊れた JSON はどちらも「まだ無い」として扱い、起動を止めない。
    return undefined
  }
}

/**
 * 読み込んだ結果。「まだ無い」と「あるが読めない」を分けるのは、後者を空として
 * 上書きすると再生成できない内容が消えるから（ADR-035）。
 */
export type StoredJson<T> =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'ok'; readonly value: T }

export const readStoredJson = async <T>(
  path: string,
  accepts: (value: unknown) => value is T
): Promise<StoredJson<T>> => {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'unreadable' }
  }

  try {
    const value = JSON.parse(text) as unknown
    return accepts(value) ? { kind: 'ok', value } : { kind: 'unreadable' }
  } catch {
    return { kind: 'unreadable' }
  }
}

/**
 * 読めなかったファイルを置き換えるときは、先に元の内容を脇へ退避する。
 * 起動は止めず、手で取り戻せる形で残す（ADR-035）。
 */
export const replaceStoredJson = async (path: string, previous: StoredJson<unknown>, value: unknown): Promise<void> => {
  if (previous.kind === 'unreadable') {
    const aside = `${path}.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`
    await rename(path, aside)
    // 本文は出さない。設定や声紋帳の中身をログに残す理由がない。
    console.warn(`[storage] 読めなかったファイルを退避しました: ${aside}`)
  }
  await writeJsonAtomic(path, value)
}

const SCHEMA_VERSION = 'schemaVersion'

/**
 * ファイルの形式の番号。番号の無いファイルは導入前に書かれたものなので v1。
 * 数値でない番号は読み解けないので、新しい側（上書きしない側）に倒す。
 */
const schemaVersionOf = (value: Record<string, unknown>): number => {
  const version = value[SCHEMA_VERSION]
  if (version === undefined) return 1
  return typeof version === 'number' ? version : Number.POSITIVE_INFINITY
}

/**
 * 形式の番号を付けて置き換える。自分が知っている番号より新しいファイルは、
 * 理解できない部分を失うので上書きしない（ADR-035）。
 */
export const replaceVersionedJson = async (
  path: string,
  previous: StoredJson<Record<string, unknown>>,
  version: number,
  value: Record<string, unknown>
): Promise<void> => {
  if (previous.kind === 'ok' && schemaVersionOf(previous.value) > version) {
    throw new StorageError({ code: 'storageNewerVersion', fileName: basename(path) })
  }
  // 番号は先頭に置く。手で開いたときに最初に目に入るように。
  await replaceStoredJson(path, previous, {
    [SCHEMA_VERSION]: version,
    ...omitKeys(value, [SCHEMA_VERSION])
  })
}

/** 丸ごと作り直すファイル向け。直前の内容は番号の確認と退避にだけ使う。 */
export const writeVersionedJson = async (
  path: string,
  version: number,
  value: Record<string, unknown>
): Promise<void> => {
  await replaceVersionedJson(path, await readStoredJson(path, isPlainObject), version, value)
}

/** 指定したキーを除く。この版が解釈するキーを外し、新しい版が足したものだけを残すのに使う。 */
export const omitKeys = (value: object, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 書き込み途中の電源断で壊れたファイルを残さないよう、一時ファイル経由で置換する。 */
export const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}
