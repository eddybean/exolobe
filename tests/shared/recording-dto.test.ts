import { describe, expect, it } from 'vitest'
import { createRecording } from '@domain/Recording'
import { toRecordingDto } from '@shared/ipc'

const recording = createRecording({ id: 'rec-1', startedAt: new Date('2026-09-06T14:30:00+09:00') })

describe('toRecordingDto', () => {
  it('予定の参加者名を素の配列で渡す', () => {
    const dto = toRecordingDto({ ...recording, participants: ['山田 太郎'] })

    expect(dto.participants).toEqual(['山田 太郎'])
  })

  it('参加者名の無い録音にはキーを作らない', () => {
    expect(toRecordingDto(recording)).not.toHaveProperty('participants')
  })
})
