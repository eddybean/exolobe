import { describe, expect, it } from 'vitest'
import { PIPELINE_STEPS } from '@domain/Recording'
import { resummarizeState } from '@renderer/resummarize'

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
})
