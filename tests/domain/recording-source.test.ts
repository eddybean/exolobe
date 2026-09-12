import { describe, expect, it } from 'vitest'
import {
  diarizationTarget,
  mixInputs,
  transcriptionTargets,
  type DualTrackSource,
  type ImportedTrackSource
} from '@domain/RecordingSource'
import { REMOTE_SPEAKER_ID, SELF_SPEAKER_ID } from '@domain/Speaker'

const dual: DualTrackSource = {
  kind: 'dual',
  systemWavPath: '/work/rec-1/system.wav',
  micWavPath: '/work/rec-1/mic.wav',
  micOffsetMs: 120,
  durationMs: 65_000
}

const single: ImportedTrackSource = {
  kind: 'single',
  wavPath: '/work/rec-2/imported.wav',
  durationMs: 65_000
}

describe('mixInputs', () => {
  it('2 トラックはシステム音声を基準にマイクをずらす', () => {
    expect(mixInputs(dual)).toEqual([
      { path: '/work/rec-1/system.wav', offsetMs: 0 },
      { path: '/work/rec-1/mic.wav', offsetMs: 120 }
    ])
  })

  it('取り込んだ音声は 1 本だけを渡す', () => {
    expect(mixInputs(single)).toEqual([{ path: '/work/rec-2/imported.wav', offsetMs: 0 }])
  })

  it('常に 1 件以上を返す（TrackMixer は 0 件を受け付けない）', () => {
    expect(mixInputs(dual).length).toBeGreaterThan(0)
    expect(mixInputs(single).length).toBeGreaterThan(0)
  })
})

describe('transcriptionTargets', () => {
  it('2 トラックはマイク＝自分・システム音声＝相手として別々に起こす', () => {
    expect(transcriptionTargets(dual)).toEqual([
      { wavPath: '/work/rec-1/mic.wav', speakerId: SELF_SPEAKER_ID },
      { wavPath: '/work/rec-1/system.wav', speakerId: REMOTE_SPEAKER_ID }
    ])
  })

  /**
   * 取り込んだ 1 本のファイルには「どの声が誰か」という情報が無い。自分の声を推定して
   * 割り当てると、外したときに自分が言っていない発言を自分のものとして残すことになる。
   */
  it('取り込んだ音声は全体を相手側として 1 回だけ起こす', () => {
    expect(transcriptionTargets(single)).toEqual([
      { wavPath: '/work/rec-2/imported.wav', speakerId: REMOTE_SPEAKER_ID }
    ])
  })

  it('取り込んだ音声を自分として起こさない', () => {
    expect(transcriptionTargets(single).some((t) => t.speakerId === SELF_SPEAKER_ID)).toBe(false)
  })
})

describe('diarizationTarget', () => {
  it('2 トラックは相手側だけにかける（自分の発話は確定しているため）', () => {
    expect(diarizationTarget(dual)).toBe('/work/rec-1/system.wav')
  })

  it('取り込んだ音声は全体にかける', () => {
    expect(diarizationTarget(single)).toBe('/work/rec-2/imported.wav')
  })
})
