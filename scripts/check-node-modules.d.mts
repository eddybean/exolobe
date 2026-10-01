/** package-lock.json と node_modules/.package-lock.json の共通の形のうち、比べる部分。 */
export interface Lockfile {
  readonly packages: Readonly<
    Record<string, { readonly version?: string; readonly optional?: boolean; readonly devOptional?: boolean }>
  >
}

export interface StaleDependency {
  readonly name: string
  readonly expected: string | undefined
  /** 入っていなければ undefined。 */
  readonly actual: string | undefined
}

export declare const findStaleDependencies: (lock: Lockfile, installed: Lockfile) => StaleDependency[]

export declare const describeStaleness: (stale: readonly StaleDependency[] | undefined) => string
