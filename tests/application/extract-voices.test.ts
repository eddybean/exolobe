import { beforeEach, describe, expect, it } from 'vitest'
import { ExtractVoices, VOICE_EXTRACTION_SAMPLE_RATE } from '@application/usecases/ExtractVoices'
import { ConfigurationError } from '@domain/errors'
import { createRecording } from '@domain/Recording'
import { SELF_SPEAKER_ID, type Speaker } from '@domain/Speaker'
import { normalize } from '@domain/vector'
import {
  FakeArtifactStore,
  FakeAudioDecoder,
  FakeRecordingRepository,
  FakeSpeakerEmbedder
} from './fakes'

const startedAt = new Date('2026-09-06T14:30:00+09:00')
const recording = createRecording({ id: 'rec-1', startedAt, title: 'サンプル会議' })

const speakers: Speaker[] = [
  { id: SELF_SPEAKER_ID, kind: 'self', label: '自分' },
  { id: 'remote:spk0', kind: 'remote', label: '参加者A' }
]
const segments = [
  { startMs: 0, endMs: 4_000, speakerId: SELF_SPEAKER_ID, text: 'おはようございます' },
  { startMs: 5_000, endMs: 20_000, speakerId: 'remote:spk0', text: 'よろしくお願いします' }
]

const voice = normalize([1, 0, 0])

let repository: FakeRecordingRepository
let artifacts: FakeArtifactStore
let embedder: FakeSpeakerEmbedder
let decoder: FakeAudioDecoder
let extract: ExtractVoices

beforeEach(async () => {
  repository = new FakeRecordingRepository()
  artifacts = new FakeArtifactStore()
  embedder = new FakeSpeakerEmbedder()
  decoder = new FakeAudioDecoder()
  embedder.byCluster.set('spk0', voice)
  await repository.save(recording)
  artifacts.transcripts.set(recording.id, { segments, speakers })
  extract = new ExtractVoices({ repository, artifacts, embedder, decoder })
})

describe('ExtractVoices', () => {
  it('audio.m4a を 16kHz へ戻し、声紋を voices.json に書く', async () => {
    const voices = await extract.execute(recording.id)

    expect(decoder.calls).toEqual([
      {
        inputPath: `/storage/${recording.slug}/audio.m4a`,
        outputPath: `/work/${recording.id}/voices.wav`,
        sampleRate: VOICE_EXTRACTION_SAMPLE_RATE
      }
    ])
    expect(voices.modelKey).toBe(embedder.modelKey)
    expect(voices.speakers).toEqual([{ speakerId: 'remote:spk0', vector: voice }])
    expect(await artifacts.readVoices(recording)).toEqual(voices)
  })

  it('一時 WAV は成功しても失敗しても片付ける', async () => {
    await extract.execute(recording.id)
    expect(artifacts.voicesWavLeft).toBe(0)

    artifacts.voices.delete(recording.id)
    embedder.error = new Error('抽出に失敗')
    await expect(extract.execute(recording.id)).rejects.toThrow('抽出に失敗')
    expect(artifacts.voicesWavLeft).toBe(0)
  })

  it('既にある声紋はそのまま返し、変換をやり直さない', async () => {
    const first = await extract.execute(recording.id)
    const second = await extract.execute(recording.id)

    expect(second).toEqual(first)
    expect(decoder.calls).toHaveLength(1)
    expect(embedder.calls).toHaveLength(1)
  })

  it('埋め込みモデルが変わっていれば取り直す', async () => {
    await extract.execute(recording.id)
    artifacts.voices.set(recording.id, {
      modelKey: '別のモデル',
      speakers: [{ speakerId: 'remote:spk0', vector: voice }]
    })

    await extract.execute(recording.id)

    expect(decoder.calls).toHaveLength(2)
  })

  it('声紋が空の voices.json は無かったものとして取り直す', async () => {
    artifacts.voices.set(recording.id, { modelKey: embedder.modelKey, speakers: [] })

    await extract.execute(recording.id)

    expect(decoder.calls).toHaveLength(1)
  })

  it('話者識別が無効なら理由を返して何もしない', async () => {
    embedder.modelKey = ''

    await expect(extract.execute(recording.id)).rejects.toBeInstanceOf(ConfigurationError)
    expect(decoder.calls).toHaveLength(0)
  })

  it('文字起こしがまだ無ければ理由を返す', async () => {
    artifacts.transcripts.delete(recording.id)

    await expect(extract.execute(recording.id)).rejects.toBeInstanceOf(ConfigurationError)
    expect(decoder.calls).toHaveLength(0)
  })

  it('話者が分かれていない録音では取り直さない', async () => {
    artifacts.transcripts.set(recording.id, {
      segments: [{ startMs: 0, endMs: 20_000, speakerId: 'remote', text: 'こんにちは' }],
      speakers: [{ id: 'remote', kind: 'remote', label: '参加者' }]
    })

    await expect(extract.execute(recording.id)).rejects.toBeInstanceOf(ConfigurationError)
    expect(decoder.calls).toHaveLength(0)
  })

  it('自分と重なる区間を除いたターンだけを埋め込みに渡す', async () => {
    artifacts.transcripts.set(recording.id, {
      segments: [
        { startMs: 0, endMs: 20_000, speakerId: 'remote:spk0', text: 'よろしく' },
        { startMs: 5_000, endMs: 8_000, speakerId: SELF_SPEAKER_ID, text: 'はい' }
      ],
      speakers
    })

    await extract.execute(recording.id)

    expect(embedder.turns).toEqual([
      { speaker: 'spk0', startMs: 0, endMs: 4_800 },
      { speaker: 'spk0', startMs: 8_200, endMs: 20_000 }
    ])
  })
})
