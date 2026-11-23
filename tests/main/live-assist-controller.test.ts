import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PastRecordingSearchPort } from '@application/ports'
import type { LiveAssistFeatures, LiveAssistListener } from '@application/usecases/live-assist'
import type { AppleIntelligenceStatus } from '@domain/AppleIntelligence'
import { defaultSettings, mergeSettings, type Settings, type SettingsPatch } from '@domain/Settings'
import { LiveAssistController, type LiveAssistSessionLike } from '../../src/main/liveAssistController'

class FakeSession implements LiveAssistSessionLike {
  began?: { recordingId: string; sampleRate: number; language: string; features: LiveAssistFeatures }
  ticks = 0
  ends = 0
  pushes = 0
  endDelayMs = 0

  async begin(params: {
    recordingId: string
    sampleRate: number
    language: 'ja' | 'en'
    features: LiveAssistFeatures
    headlineIntervalMin: number
    listener: LiveAssistListener
  }): Promise<void> {
    this.began = params
  }
  push(): void {
    this.pushes += 1
  }
  async tick(): Promise<void> {
    this.ticks += 1
  }
  async summarize(): Promise<readonly string[]> {
    return ['要点']
  }
  async extractActions() {
    return []
  }
  dismissSuggestion(): void {}
  async end(): Promise<void> {
    this.ends += 1
    if (this.endDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.endDelayMs))
  }
}

const listener: LiveAssistListener = { caption: () => {}, status: () => {}, suggestion: () => {}, headline: () => {} }
const search: PastRecordingSearchPort = { search: async () => [] }

let settings: Settings
let apple: AppleIntelligenceStatus
let sessions: { session: FakeSession; model: boolean; search: PastRecordingSearchPort | undefined }[]

const build = (options: { platform?: NodeJS.Platform; endTimeoutMs?: number } = {}) =>
  new LiveAssistController({
    settings: { load: async () => settings },
    appleIntelligence: async () => apple,
    createSession: (params) => {
      const session = new FakeSession()
      sessions.push({ session, ...params })
      return session
    },
    search,
    listener,
    uiLanguage: 'ja',
    platform: options.platform ?? 'darwin',
    tickIntervalMs: 5_000,
    endTimeoutMs: options.endTimeoutMs ?? 3_000
  })

const enable = (patch: SettingsPatch = {}): void => {
  settings = mergeSettings(defaultSettings('ja'), { ...patch, liveAssist: { enabled: true, ...patch.liveAssist } })
}

beforeEach(() => {
  settings = defaultSettings('ja')
  apple = { availability: 'available', contextSize: 8192 }
  sessions = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LiveAssistController', () => {
  it('設定で有効にしていなければ何も起こさない', async () => {
    await build().begin({ recordingId: 'r1' })

    expect(sessions).toEqual([])
  })

  it('macOS 以外では何も起こさない', async () => {
    enable()
    await build({ platform: 'win32' }).begin({ recordingId: 'r1' })

    expect(sessions).toEqual([])
  })

  it('会議の言語と録音のサンプルレート、使える機能だけを渡して始める', async () => {
    enable({ transcription: { language: 'en' }, audio: { sampleRate: 48_000 } })
    await build().begin({ recordingId: 'r1' })

    expect(sessions[0]?.session.began).toMatchObject({
      recordingId: 'r1',
      sampleRate: 48_000,
      language: 'en',
      // 意味検索が無効なので過去の録音は出さない
      features: { captions: true, pastRecordings: false, headlines: true }
    })
    expect(sessions[0]?.model).toBe(true)
    expect(sessions[0]?.search).toBeUndefined()
  })

  it('意味検索のモデルがあれば過去の録音を出す', async () => {
    enable({ search: { enabled: true, modelPath: '/models/bge-m3.gguf' } })
    await build().begin({ recordingId: 'r1' })

    expect(sessions[0]?.session.began?.features.pastRecordings).toBe(true)
    expect(sessions[0]?.search).toBe(search)
  })

  it('Apple Intelligence が使えなければ見出しを出さず、モデルも渡さない', async () => {
    enable()
    apple = { availability: 'apple-intelligence-not-enabled' }
    await build().begin({ recordingId: 'r1' })

    expect(sessions[0]?.session.began?.features.headlines).toBe(false)
    expect(sessions[0]?.model).toBe(false)
  })

  it('利用者が切った機能は出さない', async () => {
    enable({ liveAssist: { captions: false, headlines: false } })
    await build().begin({ recordingId: 'r1' })

    expect(sessions[0]?.session.began?.features).toEqual({ captions: false, pastRecordings: false, headlines: false })
  })

  it('録音の PCM をセッションへ流す', async () => {
    enable()
    const controller = build()
    controller.push('remote', new Uint8Array(2))
    await controller.begin({ recordingId: 'r1' })
    controller.push('remote', new Uint8Array(2))
    await controller.end()
    controller.push('remote', new Uint8Array(2))

    expect(sessions[0]?.session.pushes).toBe(1)
  })

  it('見出しの時期を一定の間隔で確かめ、止めたら確かめない', async () => {
    vi.useFakeTimers()
    enable()
    const controller = build()
    await controller.begin({ recordingId: 'r1' })
    await vi.advanceTimersByTimeAsync(15_000)
    await controller.end()
    await vi.advanceTimersByTimeAsync(15_000)

    expect(sessions[0]?.session.ticks).toBe(3)
  })

  it('止めるのを待つのは上限まで。認識器が終わらなくてもパイプラインを待たせない', async () => {
    vi.useFakeTimers()
    enable()
    const controller = build({ endTimeoutMs: 3_000 })
    await controller.begin({ recordingId: 'r1' })
    const session = sessions[0]?.session
    if (session) session.endDelayMs = 60_000

    let ended = false
    void controller.end().then(() => (ended = true))
    await vi.advanceTimersByTimeAsync(3_000)

    expect(ended).toBe(true)
  })

  it('始めている途中で止められたら、始め終わった後に止める', async () => {
    enable()
    const controller = build()
    const beginning = controller.begin({ recordingId: 'r1' })
    await controller.end()
    await beginning

    // セッションを作る前に止まったなら作らない。作った後なら必ず止める。
    expect(sessions.every(({ session }) => session.ends === 1)).toBe(true)
  })

  it('続けて録音を始めたら、前のセッションを止めてから作り直す', async () => {
    enable()
    const controller = build()
    await controller.begin({ recordingId: 'r1' })
    await controller.begin({ recordingId: 'r2' })

    expect(sessions.map(({ session }) => session.ends)).toEqual([1, 0])
  })

  it('セッションが無いときの要約と ToDo は空', async () => {
    const controller = build()

    await expect(controller.summarize()).resolves.toEqual([])
    await expect(controller.extractActions()).resolves.toEqual([])
  })
})
