import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

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
export const replaceStoredJson = async (
  path: string,
  previous: StoredJson<unknown>,
  value: unknown
): Promise<void> => {
  if (previous.kind === 'unreadable') {
    const aside = `${path}.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`
    await rename(path, aside)
    // 本文は出さない。設定や声紋帳の中身をログに残す理由がない。
    console.warn(`[storage] 読めなかったファイルを退避しました: ${aside}`)
  }
  await writeJsonAtomic(path, value)
}

/** 書き込み途中の電源断で壊れたファイルを残さないよう、一時ファイル経由で置換する。 */
export const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}
