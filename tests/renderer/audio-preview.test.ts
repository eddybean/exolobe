import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RecordingDto } from '@shared/ipc'
import { isAudioReady } from '@renderer/library/audio'

const dto = (encode: string): RecordingDto => ({
  id: 'rec-1',
  title: '会議',
  startedAt: '2026-09-06T05:30:00.000Z',
  durationMs: 65_000,
  status: encode === 'done' ? 'ready' : 'processing',
  steps: {
    mix: { status: 'done' },
    transcribe: { status: 'done' },
    diarize: { status: 'done' },
    summarize: { status: 'done' },
    encode: { status: encode }
  },
  slug: '2026-09-06_1430-rec-1'
})

/**
 * 音声プレビューはエンコードが終わって初めて成立する。文字起こしは先に終わるので、
 * 「文字が出ているのに再生できない」状態が実際に起きる。
 */
describe('音声プレビューの可否', () => {
  it('エンコードが終わっていれば再生できる', () => {
    expect(isAudioReady(dto('done'))).toBe(true)
  })

  it('エンコードが実行中・未実行なら再生できない', () => {
    expect(isAudioReady(dto('running'))).toBe(false)
    expect(isAudioReady(dto('pending'))).toBe(false)
  })

  it('エンコードが失敗していれば再生できない', () => {
    expect(isAudioReady(dto('failed'))).toBe(false)
  })
})

const css = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8')
const view = readFileSync(join(process.cwd(), 'src/renderer/views/RecordingDetailView.tsx'), 'utf8')

const ruleFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(^|\\})[^{}]*${escaped}[^{}]*\\{([^}]*)\\}`, 'm'))
  if (!match?.[2]) throw new Error(`styles.css に ${selector} のルールが見つかりません。`)
  return match[2]
}

/**
 * 再生できない間は、プレーヤーを残したまま無効だと分かる見た目にする。
 * 要素ごと消すとレイアウトが動き、左右パネルの上端を揃えた構成が崩れるため。
 */
describe('再生できない間の見せ方', () => {
  it('プレーヤーを薄くして操作を受け付けない', () => {
    const rule = ruleFor('.player-slot--pending .player')

    expect(rule).toMatch(/opacity:\s*0?\.\d+/)
    expect(rule).toMatch(/pointer-events:\s*none/)
  })

  it('再生できない理由を添える', () => {
    expect(view).toMatch(/エンコード/)
  })

  it('文字起こしのタイムスタンプも押せなくする', () => {
    expect(view).toMatch(/disabled=\{!audioReady\}/)
    expect(ruleFor('.segment__time:disabled')).toMatch(/opacity:\s*0?\.\d+/)
  })
})
