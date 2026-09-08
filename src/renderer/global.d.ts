/// <reference types="vite/client" />
// TypeScript 7 は副作用インポート（`import './styles.css'`）にも型宣言を要求するため、
// CSS などのアセットを宣言している vite/client を参照する。

import type { RendererApi } from '@shared/ipc'

declare global {
  interface Window {
    /** preload が contextBridge で公開する API。 */
    readonly recorder: RendererApi
  }
}

export {}
