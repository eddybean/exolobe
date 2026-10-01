import type { AppPlatform } from '@shared/platform'

/**
 * renderer が動いている OS（ADR-048）。
 *
 * 言語（i18n/locale.ts）と同じく、main.tsx が最初の描画の前に一度だけ受け取り、モジュールに持つ。
 * 文言の表やショートカットの判定のような純粋関数からも、呼び出し元に引数を足さずに引ける。
 */
let current: AppPlatform = 'macos'

export const setPlatform = (platform: AppPlatform): void => {
  current = platform
}

export const platform = (): AppPlatform => current
