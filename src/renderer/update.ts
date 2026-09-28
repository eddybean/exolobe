import type { UpdateStatusDto } from '@shared/ipc'

/** Homebrew の cask の更新。cask 名は配布する tap の cask に合わせる。 */
export const BREW_UPGRADE_COMMAND = 'brew upgrade --cask exolobe'

export type UpdateGuidance =
  | { readonly kind: 'homebrew'; readonly version: string; readonly command: string }
  | { readonly kind: 'download'; readonly version: string }
  | { readonly kind: 'upToDate'; readonly checkedAt: string }
  | { readonly kind: 'unchecked' }
  /** 「確認しない」の設定で、まだ自分で確かめていない。 */
  | { readonly kind: 'manualOnly' }

/**
 * 設定画面に出す案内（ADR-044）。
 *
 * 入れ方で分けるのは、Homebrew で入れた人が DMG で上書きすると brew の記録と実体の版が
 * 食い違うため。一度も確かめていないときは「最新」と言わない。
 *
 * `automatic` が false（確認しない設定で、まだ自分で確かめていない）なら、新しい版が無くても
 * 「最新」とは言わない。main は覚えていた版をこの設定では伏せるので、最新とは限らない。
 */
export const updateGuidance = (
  status: UpdateStatusDto,
  options: { automatic: boolean } = { automatic: true }
): UpdateGuidance => {
  const available = status.available
  if (available?.installSource === 'homebrew') {
    return { kind: 'homebrew', version: available.version, command: BREW_UPGRADE_COMMAND }
  }
  if (available) return { kind: 'download', version: available.version }
  if (!options.automatic) return { kind: 'manualOnly' }
  return status.checkedAt ? { kind: 'upToDate', checkedAt: status.checkedAt } : { kind: 'unchecked' }
}
