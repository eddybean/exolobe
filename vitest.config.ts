import { resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

/** 層を表すパスエイリアス。electron.vite.config.ts と同じものを配る。 */
export const alias = {
  '@domain': resolve('src/domain'),
  '@application': resolve('src/application'),
  '@infrastructure': resolve('src/infrastructure'),
  '@shared': resolve('src/shared'),
  '@renderer': resolve('src/renderer')
}

/**
 * 保存ディレクトリ名の生成はローカルタイムゾーンの日時を使う仕様のため、
 * テストの期待値も JST 前提で書かれている。CI ランナーは既定で UTC のため、
 * 実行環境に依存せず結果が一致するようここで固定する。
 */
export const env = {
  TZ: 'Asia/Tokyo'
}

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // tests/manual は実機の権限（TCC）と鳴っている音が要るので、CI と
    // 普段の npm test からは外す。走らせるのは npm run test:manual。
    exclude: [...configDefaults.exclude, 'tests/manual/**'],
    setupFiles: ['tests/setup.ts'],
    env
  }
})
