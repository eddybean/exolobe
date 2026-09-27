/**
 * 入力欄の「確定」キーの見分け方。
 *
 * 日本語入力では変換候補を選んで確定するのに Enter を押す。この Enter まで
 * 入力の確定として扱うと、変換の途中で編集が終わってしまい、意図しない
 * 文字列が保存される。IME の合成中に押された Enter はここで落とす。
 */
export interface CommitKeyEvent {
  readonly key: string
  /**
   * 合成中の keydown を 229 で表すのは古くからのブラウザ挙動。
   * isComposing が立たない経路（Safari の一部や合成開始直後）でも拾えるよう併用する。
   */
  readonly keyCode?: number
  readonly nativeEvent?: { readonly isComposing?: boolean }
}

export const isCommitEnter = (event: CommitKeyEvent): boolean =>
  event.key === 'Enter' && !event.nativeEvent?.isComposing && event.keyCode !== 229

/** 録音中の「今の発言に印をつける」。アプリ内だけで効く（グローバルには登録しない）。 */
export const BOOKMARK_SHORTCUT_LABEL = '⌘⇧H'

export interface ShortcutKeyEvent {
  readonly key: string
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly repeat: boolean
  readonly isComposing: boolean
}

/**
 * ⌘⇧H を印の操作として受ける。メモの入力欄にいても効かせるため、入力先は見ない。
 * 押しっぱなしの自動反復は落とす — 1 回押しただけで印が並ぶ。
 */
export const isBookmarkKey = (event: ShortcutKeyEvent): boolean =>
  event.key.toLowerCase() === 'h' &&
  event.metaKey &&
  event.shiftKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.repeat &&
  !event.isComposing
