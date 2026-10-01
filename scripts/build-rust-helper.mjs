/**
 * Windows の補助プログラム（native/<名前>、Rust）をビルドし、resources/bin/<名前>.exe に置く。
 * 配布版では electron-builder の win.extraResources が同梱する（ADR-048）。
 *
 *   node scripts/build-rust-helper.mjs syscapture   # システム音声の取り込み
 *   node scripts/build-rust-helper.mjs audioconv    # 録音の保存と音声の取り込み（Media Foundation）
 *
 * Windows 専用。他の OS では何もせずに終わる（package の流れを止めない）。
 * cargo が無ければ失敗する。無くてもアプリは起動するが、その補助プログラムの機能だけが使えない。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const name = process.argv[2]
  const manifest = name === undefined ? undefined : join(root, 'native', name, 'Cargo.toml')
  if (name === undefined || manifest === undefined || !existsSync(manifest)) {
    console.error('使い方: node scripts/build-rust-helper.mjs <native/ の下の Rust の補助プログラムの名前>')
    process.exit(2)
  }
  if (process.platform !== 'win32') {
    console.log(`[build:${name}] Windows 専用なので何もしません。`)
    process.exit(0)
  }
  // --locked で Cargo.lock の版から外れないようにする（CI と手元で同じものを作る）。
  // crate のディレクトリで呼ぶ。.cargo/config.toml（C ランタイムの静的リンク）は作業ディレクトリから探されるため。
  const cargo = spawnSync('cargo', ['build', '--release', '--locked', '--manifest-path', manifest], {
    stdio: 'inherit',
    cwd: dirname(manifest)
  })
  if (cargo.error !== undefined || cargo.status !== 0) {
    console.error(`[build:${name}] cargo build に失敗しました。Rust（rustup か mise）が入っているか確かめてください。`)
    process.exit(1)
  }
  const built = join(root, 'native', name, 'target', 'release', `${name}.exe`)
  const bundled = join(root, 'resources', 'bin', `${name}.exe`)
  mkdirSync(dirname(bundled), { recursive: true })
  copyFileSync(built, bundled)
  console.log(`[build:${name}] ${bundled}`)
}
