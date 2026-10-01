/**
 * `npm run setup` の入口。開発環境の準備を OS ごとに振り分ける。
 *
 * macOS は従来どおり setup.sh（Homebrew と sw_vers が前提）に任せる。Windows には Homebrew も
 * bash も前提にできないので、ここで道具の有無を確かめて、足りないものを知らせるだけにする。
 * 何かが欠けてもアプリはその機能だけを無効にして起動するので、準備は止めない（ADR-048）。
 * 補助プログラム（Rust）は cargo があれば、whisper-cli は Vulkan SDK があればここでビルドする
 * （macOS の setup.sh が Homebrew で whisper-cli を入れるのに当たる）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const setupCommand = (platform) =>
  platform === 'darwin' ? { command: 'bash', args: ['scripts/setup.sh'] } : undefined

/**
 * Windows で開発を始める前に確かめることの一覧。
 * @param {{ env: Record<string, string | undefined>, onPath: (name: string) => boolean, whisperBuilt: boolean }} probe
 *   whisperBuilt は npm run build:whisper が resources/bin に作ったものがあるか（開発中はそれを使う）
 */
export const windowsSetupReport = ({ env, onPath, whisperBuilt }) => {
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
    whisperBuilt || onPath('whisper-cli')
      ? { level: 'ok', subject: 'whisper-cli', message: 'whisper-cli があります。' }
      : {
          level: 'warn',
          subject: 'whisper-cli',
          message:
            'whisper-cli が見つかりません。文字起こしだけが動きません。npm run build:whisper で resources/bin に作れます' +
            '（Vulkan SDK が要ります。winget install --id KhronosGroup.VulkanSDK）。'
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
  report.push(
    env.VULKAN_SDK !== undefined
      ? { level: 'ok', subject: 'Vulkan SDK', message: `Vulkan SDK があります（${env.VULKAN_SDK}）。` }
      : {
          level: 'warn',
          subject: 'Vulkan SDK',
          message:
            'Vulkan SDK が見つかりません。whisper-cli をビルドできません。' +
            'winget install --id KhronosGroup.VulkanSDK で入れ、端末を開き直してください。'
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
  const whisperBuilt = existsSync('resources/bin/whisper-cli.exe')
  for (const item of windowsSetupReport({ env: process.env, onPath: onWindowsPath, whisperBuilt })) {
    console.log(`[setup] ${item.level === 'ok' ? 'OK' : '注意'}: ${item.message}`)
  }
  // 補助プログラムは cargo があればここで作る。無ければ上で知らせたとおり、その機能だけが無効になる。
  if (onWindowsPath('cargo')) {
    for (const helper of ['syscapture', 'audioconv']) {
      spawnSync(process.execPath, ['scripts/build-rust-helper.mjs', helper], { stdio: 'inherit' })
    }
  }
  // whisper-cli は Vulkan SDK があれば作る。既にあれば build-whisper.mjs が何もせずに終わる。
  if (process.env.VULKAN_SDK !== undefined) {
    spawnSync(process.execPath, ['scripts/build-whisper.mjs'], { stdio: 'inherit' })
  }
  console.log()
  console.log("[setup] 完了しました。'npm run dev' でアプリを起動できます。")
  console.log('[setup] モデル（文字起こし・要約）はアプリの初期設定画面からダウンロードできます。')
}
