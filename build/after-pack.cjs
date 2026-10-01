'use strict'

const { execFileSync } = require('node:child_process')
const { existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

/**
 * Apple Developer 証明書が無いときに ad-hoc 署名を行う electron-builder フック。
 *
 * このアプリは Core Audio Process Tap を使うが、その権限（NSAudioCaptureUsageDescription）
 * は署名済みバイナリでしか有効にならない。まったく署名しないと、配布物を起動しても
 * システム音声が取得できず原因も分かりにくい。ad-hoc 署名（identity `-`）であれば
 * 利用者のマシンで TCC の許可を得られるため、証明書が用意できるまでの現実的な代替になる。
 *
 * CSC_LINK / CSC_NAME が設定されている場合は本物の証明書での署名を electron-builder に
 * 任せ、このフックは何もしない。
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log('[after-pack] 証明書が指定されているため ad-hoc 署名はスキップします。')
    return
  }

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  if (!existsSync(appPath)) {
    throw new Error(`[after-pack] アプリが見つかりません: ${appPath}`)
  }

  const entitlements = join(context.packager.info.projectDir, 'build', 'entitlements.mac.plist')

  // 内側から順に署名する。先に外側を署名すると、後から中身を変更した時点で
  // 署名が壊れるため、順序が重要になる。
  for (const target of nestedTargets(appPath)) {
    sign(target, entitlements)
  }
  sign(appPath, entitlements)

  verify(appPath)
  console.log(`[after-pack] ad-hoc 署名を適用しました: ${appPath}`)
}

/** ヘルパーアプリ・フレームワーク・同梱バイナリを署名順に並べる。 */
const nestedTargets = (appPath) => {
  const targets = []
  const frameworks = join(appPath, 'Contents', 'Frameworks')

  if (existsSync(frameworks)) {
    for (const name of readdirSync(frameworks)) {
      // ヘルパーアプリ（*.app）とフレームワーク（*.framework）、単体の .dylib
      if (name.endsWith('.app') || name.endsWith('.framework') || name.endsWith('.dylib')) {
        targets.push(join(frameworks, name))
      }
    }
  }

  // 同梱した whisper-cli など。実行権を持つファイルだけを対象にする。
  const bin = join(appPath, 'Contents', 'Resources', 'bin')
  if (existsSync(bin)) {
    for (const name of readdirSync(bin)) {
      targets.push(join(bin, name))
    }
  }

  return targets
}

const sign = (target, entitlements) => {
  execFileSync(
    'codesign',
    [
      '--force',
      '--sign',
      '-', // ad-hoc
      '--options',
      'runtime', // hardened runtime を維持する
      '--entitlements',
      entitlements,
      '--timestamp=none', // ad-hoc 署名にタイムスタンプは付けられない
      target
    ],
    { stdio: 'inherit' }
  )
}

const verify = (appPath) => {
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
}
