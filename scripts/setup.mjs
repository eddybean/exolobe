/**
 * `npm run setup` の入口。開発環境の準備を OS ごとに振り分ける。
 *
 * macOS は従来どおり setup.sh（Homebrew と sw_vers が前提）に任せる。Windows には Homebrew も
 * bash も前提にできないので、ここで道具の有無を確かめて、足りないものを知らせるだけにする。
 * 何かが欠けてもアプリはその機能だけを無効にして起動するので、準備は止めない（ADR-048）。
 * 補助プログラム（Rust）は cargo があればここでビルドする。whisper-cli のビルドは Windows 版ができたらここから呼ぶ。
 */
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const setupCommand = (platform) =>
  platform === 'darwin' ? { command: 'bash', args: ['scripts/setup.sh'] } : undefined

/**
 * Windows で開発を始める前に確かめることの一覧。
 * @param {{ env: Record<string, string | undefined>, onPath: (name: string) => boolean }} probe
 */
export const windowsSetupReport = ({ env, onPath }) => {
  const report = []
  // electron が Node として動き、npm run dev が起動に失敗する。原因が分かりにくいので先に知らせる。
  if (env.ELECTRON_RUN_AS_NODE !== undefined) {
    report.push({
      level: 'warn',
      subject: 'ELECTRON_RUN_AS_NODE',
      message:
        '環境変数 ELECTRON_RUN_AS_NODE が設定されています。npm run dev が起動に失敗するので、外してから起動してください。'
    })
  }
  report.push(
    onPath('whisper-cli')
      ? { level: 'ok', subject: 'whisper-cli', message: 'whisper-cli が PATH にあります。' }
      : {
          level: 'warn',
          subject: 'whisper-cli',
          message:
            'whisper-cli が見つかりません。文字起こしだけが動きません。whisper.cpp のリリースの whisper-bin-x64.zip を展開し、' +
            '設定画面で whisper-cli.exe のパスを指定すれば試せます。'
        }
  )
  report.push(
    onPath('cargo')
      ? { level: 'ok', subject: 'cargo', message: 'cargo（Rust）が PATH にあります。' }
      : {
          level: 'warn',
          subject: 'cargo',
          message:
            'cargo（Rust）が見つかりません。システム音声・音声変換・マイク使用の見張りの補助プログラムをビルドできません。' +
            'rustup か mise で Rust を入れてください。'
        }
  )
  return report
}

const onWindowsPath = (name) => spawnSync('where.exe', [name], { stdio: 'ignore' }).status === 0

// npm run から直接実行されたときだけ動かす。テストから import したときは走らせない。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = setupCommand(process.platform)
  if (command !== undefined) {
    process.exit(spawnSync(command.command, command.args, { stdio: 'inherit' }).status ?? 1)
  }
  if (process.platform !== 'win32') {
    console.error(`[setup] ${process.platform} には対応していません（macOS と Windows のみ）。`)
    process.exit(1)
  }
  for (const item of windowsSetupReport({ env: process.env, onPath: onWindowsPath })) {
    console.log(`[setup] ${item.level === 'ok' ? 'OK' : '注意'}: ${item.message}`)
  }
  // 補助プログラムは cargo があればここで作る。無ければ上で知らせたとおり、その機能だけが無効になる。
  if (onWindowsPath('cargo')) {
    spawnSync(process.execPath, ['scripts/build-syscapture.mjs'], { stdio: 'inherit' })
  }
  console.log()
  console.log("[setup] 完了しました。'npm run dev' でアプリを起動できます。")
  console.log('[setup] モデル（文字起こし・要約）はアプリの初期設定画面からダウンロードできます。')
}
