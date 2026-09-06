import { useCallback, useState, type ReactElement } from 'react'

/** コピー結果が分かるボタン。押したことが見た目で分かるまで表示を変える。 */
export const CopyButton = ({ text, label }: { text: string; label: string }): ReactElement => {
  const [copied, setCopied] = useState(false)

  const copy = useCallback((): void => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1_500)
      })
      .catch(() => setCopied(false))
  }, [text])

  return (
    <button type="button" className="copy" onClick={copy} aria-label={label}>
      {copied ? 'コピーしました' : 'コピー'}
    </button>
  )
}
