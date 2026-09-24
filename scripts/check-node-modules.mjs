/**
 * node_modules が package-lock.json どおりに入っているかを確かめ、食い違えば止める。
 *
 * worktree を別のブランチに使い回すと、lockfile だけが新しくなり node_modules は
 * 古いまま残る。Electron が 33 のまま 44 の型で typecheck が落ちる、といった
 * 依存のずれが、コードの不具合に見える形で出てくる。npm run の前にここで弾く。
 *
 * 比べる相手は npm が install のたびに書く node_modules/.package-lock.json。
 * 実際に入れたものの記録なので、各パッケージの package.json を 600 件読まずに済む。
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** 例として並べる件数。全部並べると端末が埋まり、肝心の「npm ci」が流れる。 */
const EXAMPLE_LIMIT = 3

/** lockfile のキー（node_modules/a/node_modules/b）から先頭の node_modules/ を外す。 */
const packageName = (key) => key.replace(/^node_modules\//, '')

/**
 * lockfile と食い違うパッケージ。
 *
 * optional の依存は入っていなくてよい。別 OS 向けのネイティブなどは
 * この Mac では入らないのが正しい。入っているなら版は揃っている必要がある。
 */
export const findStaleDependencies = (lock, installed) =>
  Object.entries(lock.packages)
    .filter(([key]) => key !== '')
    .flatMap(([key, expected]) => {
      const actual = installed.packages[key]
      if (!actual) {
        return expected.optional || expected.devOptional
          ? []
          : [{ name: packageName(key), expected: expected.version, actual: undefined }]
      }
      return actual.version === expected.version
        ? []
        : [{ name: packageName(key), expected: expected.version, actual: actual.version }]
    })

/** 食い違いを利用者向けの文にする。stale が undefined なら node_modules がまだ無い。 */
export const describeStaleness = (stale) => {
  if (stale === undefined) {
    return 'node_modules がまだありません。npm ci を実行してください。'
  }

  // 版の違いを先に挙げる。「入っていない」は版が上がって依存が増えた結果であることが
  // 多く、原因（どの依存が古いまま残っているか）は版の違いの方に出る。
  const examples = [
    ...stale.filter(({ actual }) => actual !== undefined),
    ...stale.filter(({ actual }) => actual === undefined)
  ]
    .slice(0, EXAMPLE_LIMIT)
    .map(({ name, expected, actual }) =>
      actual === undefined
        ? `  ${name}: ${expected} が必要ですが入っていません`
        : `  ${name}: ${expected} が必要ですが ${actual} が入っています`
    )
  const rest = stale.length - EXAMPLE_LIMIT

  return [
    `node_modules が package-lock.json と食い違っています（${stale.length} 件）。`,
    ...examples,
    ...(rest > 0 ? [`  ほか ${rest} 件`] : []),
    'npm ci を実行してください。'
  ].join('\n')
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

// npm run から直接実行されたときだけ判定する。テストから import したときは走らせない。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lock = readJson('package-lock.json')
  const installed = readJson('node_modules/.package-lock.json')
  const stale = installed === undefined ? undefined : findStaleDependencies(lock, installed)

  if (stale === undefined || stale.length > 0) {
    console.error(describeStaleness(stale))
    process.exit(1)
  }
}
