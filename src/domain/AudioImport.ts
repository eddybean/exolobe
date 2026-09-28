import type { ErrorReason } from '@domain/errors'

/**
 * 手元の音声ファイルを取り込めるかの判定。
 *
 * 変換は /usr/bin/afconvert に任せるので、読める形式の範囲がそのまま取り込みの上限になる
 * （ffmpeg を同梱しない方針を入力側にも広げている。ADR-005 / ADR-030）。
 *
 * ここは拡張子だけを見る安いチェックで、2 段構えの 1 段目。ファイル選択のフィルタと
 * ドロップの受け入れは変換より前に答えを出さなければならず、レンダラーはディスクにも
 * 子プロセスにも触れないため、純粋な判定が必要になる。DRM 付きの m4a や音声トラックの
 * 無い mp4、壊れたファイルはここでは見抜けないので、実際の変換を最終の権威にする。
 */

/** afconvert が入力として読める拡張子。実機の `afconvert -hf` の入力一覧から起こした。 */
export const IMPORTABLE_EXTENSIONS = [
  'mp3',
  'm4a',
  'm4b',
  'aac',
  'adts',
  'mp4',
  'flac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'wave',
  'aif',
  'aiff',
  'aifc',
  'caf',
  'w64',
  'ac3',
  'eac3',
  'amr',
  'au',
  'snd'
] as const

/**
 * 音声として広く使われているが afconvert では開けない形式。
 * 「音声ファイルとして扱えません」で済ませず、形式を名指しして変換を促すために持つ。
 */
const UNREADABLE_EXTENSIONS: readonly string[] = [
  'webm',
  'mkv',
  'mka',
  'mov',
  'avi',
  'wmv',
  'wma',
  'asf',
  'ra',
  'rm',
  'ape',
  'wv'
]

const fileNameOf = (path: string): string => path.split('/').pop() ?? path

/** 小文字の拡張子（ドット無し）。無ければ空文字。 */
export const extensionOf = (path: string): string => {
  const name = fileNameOf(path)
  const dot = name.lastIndexOf('.')
  // 先頭のドットは「隠しファイル」で拡張子ではない。
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

/** 拡張子を除いたファイル名。取り込んだ録音のタイトルになる。 */
export const importTitleOf = (path: string): string => {
  const name = fileNameOf(path)
  const extension = extensionOf(path)
  return extension ? name.slice(0, name.length - extension.length - 1) : name
}

/** 取り込めない理由。取り込めるなら undefined。 */
export const unsupportedImportReason = (path: string): ErrorReason | undefined => {
  const extension = extensionOf(path)
  const fileName = fileNameOf(path)

  if (extension === '') return { code: 'importNoExtension', fileName }
  if ((IMPORTABLE_EXTENSIONS as readonly string[]).includes(extension)) return undefined
  if (UNREADABLE_EXTENSIONS.includes(extension)) {
    return { code: 'importUnreadableFormat', fileName, extension }
  }
  return { code: 'importNotAudio', fileName }
}
