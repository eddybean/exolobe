/**
 * `npm run build:whisper` の入口。配布用の whisper-cli を OS ごとにビルドして resources/bin に置く。
 *
 * macOS は従来どおり build-whisper.sh（Metal と Core ML、ADR-007 / ADR-026）に任せる。
 * Windows はここで Vulkan と CPU のビルドを作る（ADR-048）。whisper.cpp の公式のリリース資産には
 * x64 の Vulkan 版が無く、資産の付いたビルド番号も v1.9.x のタグと同じコミットではないので、自前でビルドする。
 *
 * Windows のビルドは、バックエンドを DLL に分けて実行時に読み込む（GGML_BACKEND_DL）。Vulkan を静的に
 * 組み込むと、GPU ドライバの無い機体では vulkan-1.dll が無くて whisper-cli.exe そのものが起動しない。
 * 分けておけば ggml-vulkan.dll が読めないだけで済み、CPU で最後まで動く。CPU も命令セットごとの DLL を
 * 作り、実行する機体で選ばせる（GGML_CPU_ALL_VARIANTS）。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const whisperBuildCommand = (platform) =>
  platform === 'darwin' ? { command: 'bash', args: ['scripts/build-whisper.sh'] } : undefined

export const windowsCmakeArgs = (sourceDir, buildDir) => [
  '-S',
  sourceDir,
  '-B',
  buildDir,
  '-A',
  'x64',
  '-DCMAKE_BUILD_TYPE=Release',
  '-DGGML_VULKAN=ON',
  '-DGGML_BACKEND_DL=ON',
  '-DGGML_CPU_ALL_VARIANTS=ON',
  // ビルドした機体の命令セットに合わせると、古い CPU で落ちる。
  '-DGGML_NATIVE=OFF',
  '-DBUILD_SHARED_LIBS=ON',
  '-DWHISPER_BUILD_TESTS=OFF',
  '-DWHISPER_BUILD_EXAMPLES=ON',
  '-DWHISPER_BUILD_SERVER=OFF'
]

/**
 * ビルド成果物のうち同梱するもの。whisper-cli と、それが読む DLL（whisper・ggml・各バックエンド）。
 * parakeet.dll など、whisper-cli が読まない別のライブラリは運ばない。
 */
export const bundledWhisperFiles = (files) =>
  files.filter((file) => file === 'whisper-cli.exe' || file === 'whisper.dll' || /^ggml.*\.dll$/.test(file))

/**
 * whisper-cli と各 DLL が読む Visual C++ ランタイム。Windows に最初から入っているとは限らない
 * （UCRT の api-ms-win-crt-* は Windows 10 以降に入っている）。Visual Studio の再頒布用フォルダから
 * アプリの横に置く（Microsoft が認めるアプリローカルの配置）。DLL が分かれているので、ランタイムを
 * 静的に組み込むと DLL ごとにヒープが分かれ、モジュールをまたぐ解放で壊れうるため、静的にはしない。
 */
export const VC_RUNTIME_DLLS = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'bin')

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined || result.status !== 0) {
    console.error(`[build-whisper] 失敗しました: ${command} ${args.join(' ')}`)
    process.exit(1)
  }
}

/** Visual Studio（Build Tools）の場所。 */
const visualStudio = () => {
  const programFiles = process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)'
  const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!existsSync(vswhere)) return undefined
  const found = spawnSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8' })
  return found.stdout?.trim() || undefined
}

/** PATH の cmake、無ければ Visual Studio（Build Tools）に付いてくる cmake。 */
const findCmake = () => {
  if (spawnSync('cmake', ['--version'], { stdio: 'ignore' }).status === 0) return 'cmake'
  const install = visualStudio()
  if (install === undefined) return undefined
  const cmake = join(install, 'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe')
  return existsSync(cmake) ? cmake : undefined
}

/** 再頒布用の Visual C++ ランタイム（x64）のフォルダ。版のフォルダが複数あれば新しいものを使う。 */
const findVcRuntime = () => {
  const install = visualStudio()
  if (install === undefined) return undefined
  const redist = join(install, 'VC', 'Redist', 'MSVC')
  if (!existsSync(redist)) return undefined
  const versions = readdirSync(redist)
    .filter((version) => /^[0-9]+[.]/.test(version))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
  for (const version of versions) {
    const x64 = join(redist, version, 'x64')
    if (!existsSync(x64)) continue
    for (const crt of readdirSync(x64).filter((dir) => /^Microsoft[.]VC[0-9]+[.]CRT$/.test(dir))) {
      const dir = join(x64, crt)
      if (VC_RUNTIME_DLLS.every((dll) => existsSync(join(dir, dll)))) return dir
    }
  }
  return undefined
}

/** 前のビルドの同梱物（なくなったバックエンドの DLL など）。残ると同梱物に紛れ込むので、置く前に消す。 */
const isWhisperArtifact = (file) =>
  file === 'whisper-cli.exe' || /^(ggml|whisper|parakeet).*[.]dll$/.test(file) || VC_RUNTIME_DLLS.includes(file)

const buildWindows = () => {
  const version = process.env.WHISPER_VERSION ?? 'v1.9.4'
  const ready = ['whisper-cli.exe', 'ggml-vulkan.dll', ...VC_RUNTIME_DLLS].every((file) =>
    existsSync(join(outDir, file))
  )
  if (ready && process.env.FORCE !== '1') {
    console.log('[build-whisper] resources/bin/whisper-cli.exe は既にあります（FORCE=1 で再ビルド）。')
    return
  }
  const cmake = findCmake()
  const vcRuntime = findVcRuntime()
  if (cmake === undefined || vcRuntime === undefined) {
    console.error('[build-whisper] cmake か Visual C++ の再頒布用ランタイムが見つかりません。')
    console.error('[build-whisper] Visual Studio Build Tools（C++ によるデスクトップ開発）を入れてください。')
    process.exit(1)
  }
  // Vulkan のシェーダを組み込むのに、Vulkan SDK の glslc とヘッダが要る（実行時には要らない）。
  if (process.env.VULKAN_SDK === undefined) {
    console.error('[build-whisper] Vulkan SDK が見つかりません（VULKAN_SDK が未設定）。')
    console.error('[build-whisper] winget install --id KhronosGroup.VulkanSDK で入れ、端末を開き直してください。')
    process.exit(1)
  }

  const buildDir = join(tmpdir(), 'omr-whisper-build')
  console.log(`[build-whisper] whisper.cpp ${version} を取得しています...`)
  rmSync(buildDir, { recursive: true, force: true })
  run('git', ['clone', '--depth', '1', '--branch', version, 'https://github.com/ggml-org/whisper.cpp', buildDir])

  console.log('[build-whisper] Vulkan / CPU（バックエンドは DLL）でビルドしています...')
  run(cmake, windowsCmakeArgs(buildDir, join(buildDir, 'build')))
  run(cmake, ['--build', join(buildDir, 'build'), '--config', 'Release', '--parallel'])

  const built = join(buildDir, 'build', 'bin', 'Release')
  mkdirSync(outDir, { recursive: true })
  for (const file of readdirSync(outDir).filter(isWhisperArtifact)) rmSync(join(outDir, file))
  for (const file of bundledWhisperFiles(readdirSync(built))) copyFileSync(join(built, file), join(outDir, file))
  for (const dll of VC_RUNTIME_DLLS) copyFileSync(join(vcRuntime, dll), join(outDir, dll))
  rmSync(buildDir, { recursive: true, force: true })

  console.log(`[build-whisper] 完了: ${join(outDir, 'whisper-cli.exe')}`)
  run(join(outDir, 'whisper-cli.exe'), ['--help'], { stdio: 'ignore' })
  console.log('[build-whisper] 動作確認 OK')
}

// npm run から直接実行されたときだけ動かす。テストから import したときは走らせない。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = whisperBuildCommand(process.platform)
  if (command !== undefined) {
    process.exit(spawnSync(command.command, command.args, { stdio: 'inherit' }).status ?? 1)
  }
  if (process.platform !== 'win32') {
    console.error(`[build-whisper] ${process.platform} には対応していません（macOS と Windows のみ）。`)
    process.exit(1)
  }
  buildWindows()
}
