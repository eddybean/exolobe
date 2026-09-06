import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * asar 内のパスを app.asar.unpacked 側へ読み替える。
 *
 * asar は OS から見ると 1 つのファイルなので、その中のパスを子プロセスとして
 * 起動しようとすると ENOTDIR で失敗する。Electron は `fs` の呼び出しを
 * unpacked へ透過的に振り替えるが、`child_process.spawn` は OS の実ファイルを
 * 直接見るため振り替えが効かない。
 */
export const toUnpackedPath = (path: string): string =>
  path.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked')

const AUDIOTEE_RELATIVE = join('app.asar.unpacked', 'node_modules', 'audiotee', 'bin', 'audiotee')

/**
 * 同梱した audiotee バイナリの場所を解決する。
 *
 * audiotee は自分の JS の位置からバイナリを探す（`__dirname/../bin/audiotee`）。
 * パッケージ済みアプリではその JS が asar 内にあるため、解決されるパスも asar 内に
 * なり起動に失敗する。呼び出し側から unpacked の実パスを明示的に渡して回避する。
 *
 * 開発時は asar を使わないので audiotee の既定解決で正しく動く。undefined を返して
 * そちらに任せる。
 */
export const resolveAudioTeeBinary = (params: {
  packaged: boolean
  resourcesPath: string
  exists?: (path: string) => boolean
}): string | undefined => {
  if (!params.packaged) return undefined

  const exists = params.exists ?? existsSync
  const path = join(params.resourcesPath, AUDIOTEE_RELATIVE)

  // 見つからない場合は既定解決に委ねる。誤ったパスを渡して
  // 分かりにくいエラーにするより、元の挙動のままの方が原因を追いやすい。
  return exists(path) ? path : undefined
}
