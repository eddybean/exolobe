import type { ImportAudioResultDto } from '@shared/ipc'

/**
 * ウィンドウへ落とされた音声ファイルを受け取るための判定。
 *
 * ライブラリのツリーは録音とフォルダの移動に独自 MIME のドラッグを使っている。
 * 外からのファイルと取り違えると、フォルダへの移動が効かなくなったり、取り込みの
 * オーバーレイが移動のたびに出たりする。ここはその切り分けだけを引き受ける。
 */

export const RECORDING_MIME = 'application/x-recording-id'
export const FOLDER_MIME = 'application/x-folder-id'

/**
 * ウィンドウ全体で受けるべき「外から来たファイルのドラッグ」か。
 *
 * 独自 MIME が載っていれば、Chromium が Files を併記していてもツリー内の移動として扱う。
 */
export const isExternalFileDrag = (types: readonly string[]): boolean =>
  types.includes('Files') && !types.includes(RECORDING_MIME) && !types.includes(FOLDER_MIME)

/**
 * ドラッグの入れ子の深さ。
 *
 * dragenter / dragleave は子要素をまたぐたびに飛ぶため、真偽値で持つとオーバーレイが
 * ちらつく。入った数を数えて 0 に戻ったときだけ閉じる。
 */
export const nextDragDepth = (depth: number, event: 'enter' | 'leave' | 'drop'): number => {
  switch (event) {
    case 'enter':
      return depth + 1
    case 'leave':
      return Math.max(0, depth - 1)
    case 'drop':
      return 0
  }
}

/**
 * 取り込み結果の知らせ。全部成功したなら undefined。
 *
 * 成功は一覧に録音が増えることで分かるので黙っておく。失敗だけは黙って捨てず、
 * 1 件ならその理由を、複数なら件数とファイル名を出す。
 */
export const importSummary = (result: ImportAudioResultDto): string | undefined => {
  const { failed } = result
  if (failed.length === 0) return undefined

  const only = failed[0]
  if (failed.length === 1 && only) {
    return `「${only.fileName}」を取り込めませんでした。${only.reason}`
  }

  return `${failed.length} 件を取り込めませんでした: ${failed
    .map((failure) => failure.fileName)
    .join('、')}`
}
