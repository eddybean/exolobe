import type { RendererApi } from '@shared/ipc'

declare global {
  interface Window {
    /** preload が contextBridge で公開する API。 */
    readonly recorder: RendererApi
  }
}

export {}
