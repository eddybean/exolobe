import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@domain': resolve('src/domain'),
  '@application': resolve('src/application'),
  '@infrastructure': resolve('src/infrastructure'),
  '@shared': resolve('src/shared'),
  '@renderer': resolve('src/renderer')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // パイプラインは utilityProcess で動かすため独立したエントリにする。
          'pipeline-worker': resolve('src/main/worker/pipeline-worker.ts'),
          // 意味検索もネイティブの推論を使うので、同じく独立したエントリにする。
          'search-worker': resolve('src/main/worker/search-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: { input: { index: resolve('src/preload/index.ts') } }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } }
    }
  }
})
