import { beforeEach, describe, expect, it } from 'vitest'
import type { VoiceMemoryResult } from '@application/usecases/library'
import { createVoiceLearning, type VoiceLearnedEvent } from '../../src/main/voiceLearning'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** 呼ばれた順と重なりが見えるだけの `RememberSpeakerVoice` の代役。 */
class FakeRemember {
  calls: { recordingId: string; speakerId: string; label: string }[] = []
  running = 0
  maxConcurrent = 0
  result: VoiceMemoryResult = 'remembered'
  error: Error | undefined

  private blocked = false
  private release: (() => void) | undefined

  async execute(params: { recordingId: string; speakerId: string; label: string }): Promise<VoiceMemoryResult> {
    this.calls.push(params)
    this.running += 1
    this.maxConcurrent = Math.max(this.maxConcurrent, this.running)

    try {
      if (this.blocked) await new Promise<void>((resolve) => (this.release = resolve))
      if (this.error) throw this.error
      return this.result
    } finally {
      this.running -= 1
    }
  }

  block(): void {
    this.blocked = true
  }

  unblock(): void {
    this.blocked = false
    this.release?.()
    this.release = undefined
  }
}

const params = (speakerId: string, label: string): { recordingId: string; speakerId: string; label: string } => ({
  recordingId: 'rec-1',
  speakerId,
  label
})

let remember: FakeRemember
let events: VoiceLearnedEvent[]
let learning: ReturnType<typeof createVoiceLearning>

beforeEach(() => {
  remember = new FakeRemember()
  events = []
  learning = createVoiceLearning({ remember, notify: (event) => events.push(event) })
})

describe('createVoiceLearning', () => {
  it('待たせずに受け取り、結果は後から知らせる', async () => {
    learning.enqueue(params('remote:spk0', '田中さん'))
    expect(events).toEqual([])

    await learning.settled()

    expect(events).toEqual([
      { recordingId: 'rec-1', speakerId: 'remote:spk0', label: '田中さん', status: 'remembered' }
    ])
  })

  it('続けて名前を付けても 1 件ずつ処理する', async () => {
    remember.block()
    learning.enqueue(params('remote:spk0', '田中さん'))
    learning.enqueue(params('remote:spk1', '佐藤さん'))
    await tick()

    expect(remember.running).toBe(1)

    remember.unblock()
    await learning.settled()

    expect(remember.maxConcurrent).toBe(1)
    expect(remember.calls.map((call) => call.label)).toEqual(['田中さん', '佐藤さん'])
  })

  it('覚えられなかった理由を知らせる', async () => {
    remember.result = 'unavailable'
    learning.enqueue(params('remote:spk0', '田中さん'))

    await learning.settled()

    expect(events[0]?.status).toBe('unavailable')
  })

  it('失敗しても列は止まらず、理由を知らせる', async () => {
    remember.error = new Error('話者識別が無効です。')
    learning.enqueue(params('remote:spk0', '田中さん'))
    await learning.settled()

    remember.error = undefined
    learning.enqueue(params('remote:spk1', '佐藤さん'))
    await learning.settled()

    expect(events.map((event) => event.status)).toEqual(['failed', 'remembered'])
    expect(events[0]?.message).toBe('話者識別が無効です。')
  })
})
