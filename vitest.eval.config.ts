import { defineConfig } from 'vitest/config'
import { alias, env } from './vitest.config'

/**
 * 文字起こしの評価を走らせる設定（npm run eval:transcription）。
 *
 * モデルと whisper-cli と macOS の `say` が要り、数分かかるので、既定の
 * vitest.config.ts からは外してある（あちらは *.test.ts だけを拾う）。
 */
export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/eval/**/*.eval.ts'],
    // シナリオ 5 本 × 2 構成を順に起こす。遅い機体でも途中で打ち切らない。
    testTimeout: 60 * 60 * 1000,
    // 結果の表は console に出す。vitest 5 は成功したテストの出力を既定で隠す。
    silent: false,
    env
  }
})
