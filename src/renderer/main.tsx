import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { setLocale } from './i18n/locale'
import { setPlatform } from './platform'
import './styles.css'

// 最初の描画より前に言語を決める。文言はモジュールから同期的に引くため（ADR-043）。
setLocale(window.recorder.locale)
document.documentElement.lang = window.recorder.locale
// OS も描画の前に受け取る。文言・ショートカットは platform() で、タイトルバーの余白などの見た目は
// CSS の data-platform で引き分ける（ADR-048）。
setPlatform(window.recorder.platform)
document.documentElement.dataset['platform'] = window.recorder.platform

const container = document.getElementById('root')
if (!container) throw new Error('#root not found.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
