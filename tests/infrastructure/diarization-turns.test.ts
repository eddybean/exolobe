import { describe, expect, it } from 'vitest'
import { limitSpeakers } from '@infrastructure/diarization/turns'
import { NullDiarizer } from '@infrastructure/diarization/SherpaOnnxDiarizer'

const turn = (startMs: number, endMs: number, speaker: string) => ({ startMs, endMs, speaker })

describe('limitSpeakers', () => {
  it('上限以内ならそのまま返す', () => {
    const turns = [turn(0, 1000, 'spk0'), turn(1000, 2000, 'spk1')]
    expect(limitSpeakers(turns, 6)).toEqual(turns)
  })

  it('発話時間の長い話者を優先して上限まで残す', () => {
    const turns = [
      turn(0, 10_000, 'spk0'), // 10 秒
      turn(10_000, 15_000, 'spk1'), // 5 秒
      turn(15_000, 15_200, 'spk2') // 0.2 秒（相槌や雑音）
    ]

    expect(limitSpeakers(turns, 2).map((t) => t.speaker)).toEqual(['spk0', 'spk1'])
  })

  it('同じ話者の複数ターンを合算して判断する', () => {
    const turns = [
      turn(0, 1_000, 'spk0'),
      turn(2_000, 3_000, 'spk0'),
      turn(3_000, 4_500, 'spk1') // 単発では最長だが合算では spk0 に劣る
    ]

    expect(limitSpeakers(turns, 1).map((t) => t.speaker)).toEqual(['spk0', 'spk0'])
  })

  it('上限 0 以下は制限なしとして扱う', () => {
    const turns = [turn(0, 1000, 'spk0'), turn(1000, 2000, 'spk1')]
    expect(limitSpeakers(turns, 0)).toEqual(turns)
  })

  it('空でも壊れない', () => {
    expect(limitSpeakers([], 3)).toEqual([])
  })
})

describe('NullDiarizer', () => {
  it('ターンを返さないので話者は自分と参加者の 2 名のままになる', async () => {
    expect(await new NullDiarizer().diarize()).toEqual([])
  })
})
