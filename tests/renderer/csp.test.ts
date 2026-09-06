import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * レンダラーの CSP が、マイク取り込みに必要な読み込みを塞いでいないことを確かめる。
 *
 * かつて `default-src 'self'` だけを指定していたため、Blob URL から読み込む
 * AudioWorklet がブロックされ、Chromium の既定メッセージ
 * "The user aborted a request." だけが表示される状態になっていた。
 * 権限やデバイスの問題と区別がつかず原因を追いにくいので、ここで固定する。
 */
const html = readFileSync(join(process.cwd(), 'src/renderer/index.html'), 'utf8')

const cspContent = (): string => {
  const match = html.match(
    /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]+)"/
  )
  if (!match?.[1]) throw new Error('index.html に CSP が見つかりません。')
  return match[1]
}

const directive = (name: string): string[] => {
  const found = cspContent()
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `))

  return found ? found.split(/\s+/).slice(1) : []
}

describe('レンダラーの CSP', () => {
  it('CSP を指定している', () => {
    expect(cspContent().length).toBeGreaterThan(0)
  })

  it('script-src で blob: を許可する（AudioWorklet の読み込みに必要）', () => {
    expect(directive('script-src')).toContain('blob:')
  })

  it('script-src で自身のスクリプトを許可する', () => {
    expect(directive('script-src')).toContain("'self'")
  })

  it('リモートのスクリプト読み込みは許可しない', () => {
    const sources = directive('script-src')

    expect(sources).not.toContain('*')
    expect(sources.some((source) => source.startsWith('http'))).toBe(false)
  })

  it('既定の取得元は自身に限定したままにする', () => {
    expect(directive('default-src')).toEqual(["'self'"])
  })

  it('保存先の音声を file: から再生できる', () => {
    // 詳細画面のプレーヤーは file:// で保存先の m4a を読む
    expect(directive('media-src')).toContain('file:')
  })
})
