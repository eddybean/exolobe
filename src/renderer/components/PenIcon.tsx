import type { ReactElement } from 'react'

/** 文字起こしの本文を直す。本文の末尾に文字と同じ行で並ぶので、字の高さに合わせる。 */
export const PenIcon = (): ReactElement => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path
      d="M8.2 1.3l2.5 2.5-6.9 6.9H1.3V8.2z M7 2.5l2.5 2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
)
