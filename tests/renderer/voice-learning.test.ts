import { describe, expect, it } from 'vitest'
import type { VoiceLearnedDto } from '@shared/ipc'
import { voiceLearnedNotice } from '../../src/renderer/library/voiceLearning'

const event = (patch: Partial<VoiceLearnedDto>): VoiceLearnedDto => ({
  recordingId: 'rec-1',
  speakerId: 'remote:spk0',
  label: '田中さん',
  status: 'remembered',
  ...patch
})

describe('voiceLearnedNotice', () => {
  it('覚えられたときは何も言わない', () => {
    expect(voiceLearnedNotice(event({ status: 'remembered' }))).toBeUndefined()
  })

  it('自分の呼び名は覚える対象ではないので何も言わない', () => {
    expect(voiceLearnedNotice(event({ status: 'skipped-self' }))).toBeUndefined()
  })

  it('声紋が得られなかったときは、次回に引き継がれないことを伝える', () => {
    expect(voiceLearnedNotice(event({ status: 'unavailable' }))).toBe(
      '「田中さん」の声は覚えられませんでした。この名前は次回以降の録音には引き継がれません。'
    )
  })

  it('失敗したときは理由をそのまま見せる', () => {
    expect(
      voiceLearnedNotice(
        event({ status: 'failed', message: '話者識別が無効なため、この録音から声を覚えられません。' })
      )
    ).toBe(
      '「田中さん」の声は覚えられませんでした ―― 話者識別が無効なため、この録音から声を覚えられません。'
    )
  })

  it('理由が付いていない失敗でも、覚えられなかったことは伝える', () => {
    expect(voiceLearnedNotice(event({ status: 'failed' }))).toBe(
      '「田中さん」の声は覚えられませんでした。この名前は次回以降の録音には引き継がれません。'
    )
  })
})
