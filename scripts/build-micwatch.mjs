/**
 * `npm run build:micwatch` の入口。マイク使用の見張り（ADR-027）を OS ごとに作り、resources/bin に置く。
 *
 * macOS は Swift 版（native/micwatch/main.swift）を build-micwatch.sh で、Windows は Rust 版
 * （native/micwatch の Cargo.toml、ADR-048）を build-rust-helper.mjs で作る。どちらも出力の取り決め
 * （`1` / `0` の 1 行）は同じで、TypeScript 側（MicUsageProbe）は OS を問わず同じものを使う。
 */
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const micwatchBuildCommand = (platform) => {
  if (platform === 'darwin') return { command: 'bash', args: ['scripts/build-micwatch.sh'] }
  if (platform === 'win32') return { command: process.execPath, args: ['scripts/build-rust-helper.mjs', 'micwatch'] }
  return undefined
}

// npm run から直接実行されたときだけ動かす。テストから import したときは走らせない。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = micwatchBuildCommand(process.platform)
  if (command === undefined) {
    console.error(`[build:micwatch] ${process.platform} には対応していません（macOS と Windows のみ）。`)
    process.exit(1)
  }
  process.exit(spawnSync(command.command, command.args, { stdio: 'inherit' }).status ?? 1)
}
