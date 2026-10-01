/**
 * Windows のシステム音声の取り込みに使う syscapture.exe（native/syscapture、Rust）をビルドし、
 * resources/bin に置く。配布版では electron-builder の win.extraResources が同梱する（ADR-048）。
 *
 * Windows 専用。他の OS では何もせずに終わる（package の流れを止めない）。
 * cargo が無ければ失敗する。無くてもアプリは起動するが、相手の声が録れない。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const syscapturePaths = (repoRoot) => ({
  manifest: join(repoRoot, 'native', 'syscapture', 'Cargo.toml'),
  built: join(repoRoot, 'native', 'syscapture', 'target', 'release', 'syscapture.exe'),
  bundled: join(repoRoot, 'resources', 'bin', 'syscapture.exe')
})

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.platform !== 'win32') {
    console.log('[build:syscapture] Windows 専用なので何もしません。')
    process.exit(0)
  }
  const paths = syscapturePaths(root)
  // --locked で Cargo.lock の版から外れないようにする（CI と手元で同じものを作る）。
  const cargo = spawnSync('cargo', ['build', '--release', '--locked', '--manifest-path', paths.manifest], {
    stdio: 'inherit',
    shell: false
  })
  if (cargo.error !== undefined || cargo.status !== 0) {
    console.error(
      '[build:syscapture] cargo build に失敗しました。Rust（rustup か mise）が入っているか確かめてください。'
    )
    process.exit(1)
  }
  mkdirSync(dirname(paths.bundled), { recursive: true })
  copyFileSync(paths.built, paths.bundled)
  console.log(`[build:syscapture] ${paths.bundled}`)
}
