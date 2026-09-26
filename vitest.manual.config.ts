import { defineConfig } from 'vitest/config'
import { alias, env } from './vitest.config'

/**
 * 実機でしか確かめられないものを走らせる設定（npm run test:manual）。
 *
 * 音声の取得や権限まわりは Fake では検証できないため、依存を上げたあとに
 * 手元で通す。CI では落ちるので、既定の vitest.config.ts からは外してある。
 */
export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/manual/**/*.test.ts'],
    // 実機の音や録音デバイスを取り合わないよう、1 ファイルずつ走らせる。
    fileParallelism: false,
    env
  }
})
