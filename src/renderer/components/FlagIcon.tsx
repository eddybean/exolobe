import type { ReactElement } from 'react'

/** 録音中につけた印（ADR-042）。録音中の画面と録音後の詳細で同じ形を使う。 */
export const FlagIcon = (): ReactElement => (
  <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true" className="flag-icon">
    <path d="M1 1h10l-3 4 3 4H1z" fill="currentColor" />
    <path d="M1 1v13" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)
