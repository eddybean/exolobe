/**
 * 例外から利用者に見せる本文を取り出す。
 *
 * ipcRenderer.invoke は main 側の例外に
 * 「Error invoking remote method 'models:delete': Error: 」という前置きを付けて
 * 投げ直す。そのまま出すと肝心の日本語メッセージが埋もれるので剥がす。
 */
export const messageOf = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error)

  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, '')
}
