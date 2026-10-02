/**
 * 版上げ（bump-version.yml の PR）を見分ける判定と、版に左右されない依存のキー。
 *
 * 版上げのマージは package.json と package-lock.json の版しか変えず、中身はマージ前の main と同じ。
 * CI の macOS と Windows のランナーで確かめ直しても同じ結果にしかならないので、ci.yml はここで飛ばす。
 * node_modules のキャッシュのキーも、lockfile 全体のハッシュだと版を上げるたびに変わり、
 * Release が毎回キャッシュを外して npm ci からやり直していた。キーは版を除いた中身から作る。
 *
 * 使い方（CI から）:
 *   node scripts/version-bump.mjs only-version <比べる元のコミット>   # true / false を出す
 *   node scripts/version-bump.mjs key                                # key=<ハッシュ> を出す
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const VERSIONED_FILES = new Set(['package.json', 'package-lock.json'])

/** 版の欄を除いた写し。lockfile は先頭と packages[''] の 2 か所に版を持つ。 */
const withoutVersion = (json) => {
  const { version: _version, ...rest } = json
  const root = rest.packages?.['']
  if (root === undefined) return rest
  const { version: _rootVersion, ...rootRest } = root
  return { ...rest, packages: { ...rest.packages, '': rootRest } }
}

const parse = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * 変更が package.json と package-lock.json の版だけか。
 *
 * 迷ったら false（CI を回す側）に倒す。読めない JSON や変更の無い差分は、版だけと言い切れない。
 * @param {{ path: string, before: string, after: string }[]} changes
 */
export const isVersionOnlyChange = (changes) =>
  changes.length > 0 &&
  changes.every(({ path, before, after }) => {
    if (!VERSIONED_FILES.has(path)) return false
    const [a, b] = [parse(before), parse(after)]
    return a !== undefined && b !== undefined && isDeepStrictEqual(withoutVersion(a), withoutVersion(b))
  })

/** node_modules のキャッシュのキー。版を上げても変わらず、依存が変われば変わる。 */
export const dependencyKey = (lockText) =>
  createHash('sha256')
    .update(JSON.stringify(withoutVersion(JSON.parse(lockText))))
    .digest('hex')

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/** base から HEAD までの変更。消えた・増えたファイルは版だけの変更ではないので空文字で比べて false にする。 */
const changesSince = (base) =>
  git('diff', '--name-only', base, 'HEAD')
    .split('\n')
    .filter((path) => path !== '')
    .map((path) => {
      const show = (rev) => {
        try {
          return git('show', `${rev}:${path}`)
        } catch {
          return ''
        }
      }
      return { path, before: show(base), after: show('HEAD') }
    })

// npm run や CI から直接実行されたときだけ動く。テストから import したときは走らせない。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, base] = process.argv.slice(2)
  if (command === 'only-version' && base !== undefined) {
    console.log(String(isVersionOnlyChange(changesSince(base))))
  } else if (command === 'key') {
    console.log(`key=${dependencyKey(readFileSync('package-lock.json', 'utf8'))}`)
  } else {
    console.error('usage: version-bump.mjs only-version <base> | key')
    process.exit(2)
  }
}
