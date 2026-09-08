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
