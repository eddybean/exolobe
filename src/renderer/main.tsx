import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { setLocale } from './i18n/locale'
import './styles.css'

// 最初の描画より前に言語を決める。文言はモジュールから同期的に引くため（ADR-043）。
setLocale(window.recorder.locale)
document.documentElement.lang = window.recorder.locale

const container = document.getElementById('root')
if (!container) throw new Error('#root not found.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
