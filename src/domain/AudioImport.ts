import type { ErrorReason } from '@domain/errors'

/**
 * 手元の音声ファイルを取り込めるかの判定。
 *
 * 変換は OS の変換器（macOS は afconvert、Windows は Media Foundation）に任せるので、読める形式の範囲が
 * そのまま取り込みの上限になる（ffmpeg を同梱しない方針を入力側にも広げている。ADR-005 / ADR-030 / ADR-048）。
 * domain は OS を知らないので、どの一覧を使うかは結線（container）が決めて渡す。
 *
 * ここは拡張子だけを見る安いチェックで、2 段構えの 1 段目。ファイル選択のフィルタと
 * ドロップの受け入れは変換より前に答えを出さなければならず、レンダラーはディスクにも
 * 子プロセスにも触れないため、純粋な判定が必要になる。DRM 付きの m4a や音声トラックの
 * 無い mp4、壊れたファイルはここでは見抜けないので、実際の変換を最終の権威にする。
 */

/** 変換器が読める拡張子と、音声として広く使われているのに読めない拡張子。 */
export interface ImportFormats {
  readonly importable: readonly string[]
  /** 「音声ファイルとして扱えません」で済ませず、形式を名指しして変換を促すために持つ。 */
  readonly unreadable: readonly string[]
}

/** macOS の afconvert。読める側は実機の `afconvert -hf` の入力一覧から起こした。 */
export const AFCONVERT_IMPORT_FORMATS: ImportFormats = {
  importable: [
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
  ],
  unreadable: ['webm', 'mkv', 'mka', 'mov', 'avi', 'wmv', 'wma', 'asf', 'ra', 'rm', 'ape', 'wv']
}

/**
 * Windows の Media Foundation。Windows 11 の実機で各形式を変換して確かめた（2026-10）。
 * webm / mkv の Opus のように、ストアの拡張機能が入っているかで読めるかが変わるものもある。
 * 読めなければ変換の段で「読み取れませんでした」になるので、ここでは広めに受け入れる。
 */
export const MEDIA_FOUNDATION_IMPORT_FORMATS: ImportFormats = {
  importable: [
    'mp3',
    'm4a',
    'm4b',
    'aac',
    'adts',
    'mp4',
    '3gp',
    'mov',
    'wav',
    'wave',
    'wma',
    'asf',
    'wmv',
    'flac',
    'webm',
    'mkv',
    'mka',
    'avi',
    'amr'
  ],
  unreadable: [
    'ogg',
    'oga',
    'opus',
    'aif',
    'aiff',
    'aifc',
    'caf',
    'au',
    'snd',
    'w64',
    'ac3',
    'eac3',
    'ra',
    'rm',
    'ape',
    'wv'
  ]
}

/**
 * 取り込めないときに「〜などに変換して」と案内する形式。全部並べても読まれないので、よく使うものだけ。
 * どの OS の変換器でも読めるものに限る（ogg や aiff は Windows で読めない）。
 */
export const SUGGESTED_IMPORT_FORMATS: readonly string[] = ['mp3', 'm4a', 'wav', 'flac']

// domain は node:path を使えないので、どちらの OS のパスでも区切れるよう \ でも分ける。
// macOS のファイル名に \ が入っていると手前が落ちるが、タイトルの初期値が短くなるだけで済む。
const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path

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
export const unsupportedImportReason = (path: string, formats: ImportFormats): ErrorReason | undefined => {
  const extension = extensionOf(path)
  const fileName = fileNameOf(path)

  if (extension === '') return { code: 'importNoExtension', fileName }
  if (formats.importable.includes(extension)) return undefined
  if (formats.unreadable.includes(extension)) {
    return { code: 'importUnreadableFormat', fileName, extension }
  }
  return { code: 'importNotAudio', fileName }
}
