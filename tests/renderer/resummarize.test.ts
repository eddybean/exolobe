import { describe, expect, it } from 'vitest'
import { PIPELINE_STEPS } from '@domain/Recording'
import { canEditSummary, resummarizeState } from '@renderer/resummarize'

type Steps = Record<string, { status: string }>

const steps = (overrides: Steps = {}): Steps => ({
  ...Object.fromEntries(PIPELINE_STEPS.map((step) => [step, { status: 'done' }])),
  ...overrides
})

describe('resummarizeState', () => {
  it('要約が済んでいても、もう一度要約できる', () => {
    // 話者名を直したあとに要約を作り直せることが、この機能の目的。
    expect(resummarizeState(steps(), true)).toBe('ready')
  })

  it('要約に失敗した状態からも押せる', () => {
    expect(resummarizeState(steps({ summarize: { status: 'failed' } }), true)).toBe('ready')
  })

  it('文字起こしがまだ無ければ要約する材料が無い', () => {
    expect(resummarizeState(steps({ transcribe: { status: 'pending' } }), false)).toBe(
      'unavailable'
    )
  })

  it('要約の実行中はそれと分かるようにする', () => {
    expect(resummarizeState(steps({ summarize: { status: 'running' } }), true)).toBe('summarizing')
  })

  it('他のステップが動いている間は押させない', () => {
    // ワーカーはジョブを直列に捌くので、押せても待たされるだけ。
    expect(resummarizeState(steps({ encode: { status: 'running' } }), true)).toBe('busy')
  })

  it('文字起こしの実行中は、まだ材料が無くても「処理中」として扱う', () => {
    expect(resummarizeState(steps({ transcribe: { status: 'running' } }), false)).toBe('busy')
  })

  it('要約が順番を待っている間は、受け付けたことが分かるようにして押させない', () => {
    expect(resummarizeState(steps({ summarize: { status: 'queued' } }), true)).toBe('queued')
  })

  it('他のステップが順番を待っている間も押させない', () => {
    expect(resummarizeState(steps({ diarize: { status: 'queued' } }), true)).toBe('busy')
  })
})

describe('canEditSummary', () => {
  it('要約が済んでいれば手で直せる', () => {
    expect(canEditSummary(steps())).toBe(true)
  })

  it('要約に失敗していても、手で書ける', () => {
    expect(canEditSummary(steps({ summarize: { status: 'failed' } }))).toBe(true)
  })

  it('要約の実行中は直させない', () => {
    // 書き終わった直後に生成結果で上書きされ、直した内容が黙って消える。
    expect(canEditSummary(steps({ summarize: { status: 'running' } }))).toBe(false)
  })

  it('要約が順番を待っている間も直させない', () => {
    expect(canEditSummary(steps({ summarize: { status: 'queued' } }))).toBe(false)
  })

  it('要約がこれから走る間も直させない', () => {
    expect(canEditSummary(steps({ summarize: { status: 'pending' } }))).toBe(false)
  })
})
