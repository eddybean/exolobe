/** 比べる前と後のファイルの中身。消えた・増えたファイルは無い側を空文字にする。 */
export interface FileChange {
  readonly path: string
  readonly before: string
  readonly after: string
}

export declare const isVersionOnlyChange: (changes: readonly FileChange[]) => boolean

export declare const dependencyKey: (lockText: string) => string
