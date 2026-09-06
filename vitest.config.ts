import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@domain': resolve('src/domain'),
      '@application': resolve('src/application'),
      '@infrastructure': resolve('src/infrastructure'),
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 保存ディレクトリ名の生成はローカルタイムゾーンの日時を使う仕様のため、
    // テストの期待値も JST 前提で書かれている。CI ランナーは既定で UTC のため、
    // 実行環境に依存せず結果が一致するようここで固定する。
    env: {
      TZ: 'Asia/Tokyo'
    }
  }
})
