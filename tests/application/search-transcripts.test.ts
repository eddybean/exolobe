import { beforeEach, describe, expect, it } from 'vitest'

import { SearchTranscripts } from '@application/usecases/SearchTranscripts'
import { createRecording, type Recording } from '@domain/Recording'
import type { Speaker } from '@domain/Speaker'

import { FakeArtifactStore, FakeRecordingRepository } from './fakes'

const speakers: Speaker[] = [
  { id: 'self', kind: 'self', label: '自分' },
  { id: 'remote', kind: 'remote', label: '田中' }
]

const ready = (id: string, startedAt: string, title: string): Recording => ({
  ...createRecording({ id, startedAt: new Date(startedAt), title }),
  status: 'ready'
})

const weather = ready('rec-weather', '2026-09-01T10:00:00+09:00', '週次定例')
const budget = ready('rec-budget', '2026-09-02T10:00:00+09:00', '経営会議')

let repository: FakeRecordingRepository
let artifacts: FakeArtifactStore

const usecase = (): SearchTranscripts => new SearchTranscripts({ repository, artifacts })

beforeEach(async () => {
  repository = new FakeRecordingRepository()
  artifacts = new FakeArtifactStore()

  for (const recording of [weather, budget]) await repository.save(recording)

  await artifacts.writeTranscript(weather, {
    segments: [
      { startMs: 0, endMs: 1_000, speakerId: 'self', text: 'おはようございます' },
      { startMs: 1_000, endMs: 4_000, speakerId: 'remote', text: '今日は雨が降りそうですね' }
    ],
    speakers
  })
  await artifacts.writeTranscript(budget, {
    segments: [
      { startMs: 0, endMs: 3_000, speakerId: 'remote', text: '来期の予算を見直します' },
      { startMs: 3_000, endMs: 6_000, speakerId: 'self', text: '予算の内訳を共有します' }
    ],
    speakers
  })
})

describe('SearchTranscripts', () => {
  it('本文に語を含む発言を、録音と話者の名前を添えて返す', async () => {
    const hits = await usecase().execute({ query: '雨' })

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      recordingId: 'rec-weather',
      title: '週次定例',
      startedAt: weather.startedAt,
      startMs: 1_000,
      speakerLabel: '田中',
      excerpt: '今日は雨が降りそうですね'
    })
    expect(hits[0]?.ranges).toEqual([{ start: 3, length: 1 }])
  })

  it('空白だけのクエリでは何も返さない（全件が並んで一覧を埋めない）', async () => {
    expect(await usecase().execute({ query: '  　' })).toEqual([])
  })

  it('文字起こしがまだ無い録音は飛ばす', async () => {
    const recording = ready('rec-new', '2026-09-03T10:00:00+09:00', '録音中のもの')
    await repository.save(recording)

    const hits = await usecase().execute({ query: '予算' })

    expect(hits.map((hit) => hit.recordingId)).toEqual(['rec-budget', 'rec-budget'])
  })

  it('新しい録音から順に返す', async () => {
    const hits = await usecase().execute({ query: 'ます' })

    expect(hits.map((hit) => hit.recordingId)).toEqual(['rec-budget', 'rec-budget', 'rec-weather'])
  })

  it('1 件の録音から返す発言の数を絞る（1 つの録音が結果を埋め尽くさない）', async () => {
    const hits = await usecase().execute({ query: '予算', perRecording: 1 })

    expect(hits).toHaveLength(1)
    expect(hits[0]?.startMs).toBe(0)
  })

  it('全体の上限で打ち切る', async () => {
    const hits = await usecase().execute({ query: 'ます', limit: 2 })

    expect(hits).toHaveLength(2)
  })

  it('語をすべて含む発言だけを返す', async () => {
    const hits = await usecase().execute({ query: '予算 内訳' })

    expect(hits.map((hit) => hit.startMs)).toEqual([3_000])
  })

  it('話者の名前が分からなければ id をそのまま見出しに使う', async () => {
    await artifacts.writeTranscript(weather, {
      segments: [{ startMs: 0, endMs: 1_000, speakerId: 'remote:spk3', text: '雨の話' }],
      speakers
    })

    const hits = await usecase().execute({ query: '雨' })

    expect(hits[0]?.speakerLabel).toBe('remote:spk3')
  })
})
