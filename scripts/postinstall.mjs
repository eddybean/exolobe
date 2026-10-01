/**
 * npm の postinstall から、`install-electron` の後に呼ばれる。
 *
 * 開発用 Electron.app に音声キャプチャの許可の説明文を入れる処理（patch-dev-electron.sh）は
 * macOS にしか要らず、bash・PlistBuddy・codesign を前提にしている。package.json に
 * `bash ... || true` と直接書くと、npm が cmd で実行する Windows では `true` が無く
 * npm ci ごと落ちるため、OS の判定と失敗の握りつぶしをここで行う（ADR-048）。
 */
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const devElectronPatchCommand = (platform) =>
  platform === 'darwin' ? { command: 'bash', args: ['scripts/patch-dev-electron.sh'] } : undefined

// npm run から直接実行されたときだけ動かす。テストから import したときは走らせない。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const patch = devElectronPatchCommand(process.platform)
  // 直せなくても依存の導入は止めない（元の `|| true` と同じ）。許可が取れないことは起動して分かる。
  if (patch !== undefined) spawnSync(patch.command, patch.args, { stdio: 'inherit' })
}
