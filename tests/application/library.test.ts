import { beforeEach, describe, expect, it } from 'vitest'
import {
  AddBookmark,
  DeleteRecording,
  EditSegmentText,
  GetRecordingDetail,
  GetSetupState,
  ListRecordings,
  RenameRecording,
  ClearVoiceprints,
  ListVoiceprints,
  RemoveVoiceprint,
  RememberSpeakerVoice,
  RenameSpeaker,
  UpdateNote,
  UpdateSummary,
  UpdateSettings
} from '@application/usecases/library'
import type { VoiceMemoryResult } from '@application/usecases/library'
import { ConfigurationError } from '@domain/errors'
import { createRecording, startStep } from '@domain/Recording'
import { defaultSettings } from '@domain/Settings'
import { SELF_SPEAKER_ID, type Speaker } from '@domain/Speaker'
import {
  FakeArtifactStore,
  FakeClock,
  FakeVoiceExtraction,
  FakeRecordingRepository,
  FakeSettingsRepository,
  FakeVoiceprintRepository
} from './fakes'
import { normalize } from '@domain/vector'
import type { Voiceprint } from '@domain/Voiceprint'

const startedAt = new Date('2026-09-06T14:30:00+09:00')
const recording = createRecording({ id: 'rec-1', startedAt, title: 'サンプル会議' })

const speakers: Speaker[] = [
  { id: SELF_SPEAKER_ID, kind: 'self', label: '自分' },
  { id: 'remote:spk0', kind: 'remote', label: '参加者A' }
]
const segments = [
  { startMs: 0, endMs: 1000, speakerId: SELF_SPEAKER_ID, text: 'おはようございます' },
  { startMs: 2000, endMs: 3000, speakerId: 'remote:spk0', text: 'よろしくお願いします' }
]

let repository: FakeRecordingRepository
let artifacts: FakeArtifactStore
let deps: { repository: FakeRecordingRepository; artifacts: FakeArtifactStore }

beforeEach(async () => {
  repository = new FakeRecordingRepository()
  artifacts = new FakeArtifactStore()
  deps = { repository, artifacts }
  await repository.save(recording)
})

describe('ListRecordings', () => {
  it('要約の 1 行目をプレビューとして添える', async () => {
    await artifacts.writeSummary(recording, '## 概要\n新機能のリリース日を決めた')

    const list = await new ListRecordings(deps).execute()

    expect(list[0]?.summaryPreview).toBe('概要')
  })

  it('要約が無ければプレビューは undefined にする', async () => {
    expect((await new ListRecordings(deps).execute())[0]?.summaryPreview).toBeUndefined()
  })

  it('録音が無ければ空配列を返す', async () => {
    await repository.remove('rec-1')
    expect(await new ListRecordings(deps).execute()).toEqual([])
  })
})

describe('GetRecordingDetail', () => {
  beforeEach(async () => {
    await artifacts.writeTranscript(recording, { segments, speakers })
    await artifacts.writeSummary(recording, '## 概要\n定例会')
    await artifacts.writeNote(recording, '自分用メモ')
  })

  it('詳細画面に必要な情報を揃えて返す', async () => {
    const detail = await new GetRecordingDetail(deps).execute('rec-1')

    expect(detail.recording.id).toBe('rec-1')
    expect(detail.segments).toEqual(segments)
    expect(detail.speakers).toEqual(speakers)
    expect(detail.summary).toBe('## 概要\n定例会')
    expect(detail.note).toBe('自分用メモ')
    expect(detail.audioPath).toContain('audio.m4a')
    expect(detail.bookmarks).toEqual([])
  })

  it('録音中につけた印を返す', async () => {
    await artifacts.writeBookmarks(recording, [{ atMs: 2_000 }])

    const detail = await new GetRecordingDetail(deps).execute('rec-1')

    expect(detail.bookmarks).toEqual([{ atMs: 2_000 }])
  })

  it('コピー用に話者ラベルを解決したテキストを作る', async () => {
    const detail = await new GetRecordingDetail(deps).execute('rec-1')

    expect(detail.transcriptMarkdown).toBe(
      '自分: おはようございます\n参加者A: よろしくお願いします'
    )
  })

  it('処理中で文字起こしがまだ無くても開ける', async () => {
    const other = createRecording({ id: 'rec-2', startedAt })
    await repository.save(other)

    const detail = await new GetRecordingDetail(deps).execute('rec-2')

    expect(detail.segments).toEqual([])
    expect(detail.transcriptMarkdown).toBe('')
    expect(detail.note).toBe('')
  })

  it('存在しない録音は開けない', async () => {
    await expect(new GetRecordingDetail(deps).execute('unknown')).rejects.toThrow(
      '録音が見つかりません: unknown'
    )
  })
})

describe('UpdateNote', () => {
  it('メモを保存する', async () => {
    await new UpdateNote(deps).execute({ recordingId: 'rec-1', note: '次回までに調査' })

    expect(await artifacts.readNote(recording)).toBe('次回までに調査')
  })

  it('空文字での上書きも許す（メモの削除）', async () => {
    await artifacts.writeNote(recording, '古いメモ')
    await new UpdateNote(deps).execute({ recordingId: 'rec-1', note: '' })

    expect(await artifacts.readNote(recording)).toBe('')
  })
})

describe('AddBookmark', () => {
  it('印を時刻順に足していく', async () => {
    await new AddBookmark(deps).execute({ recordingId: 'rec-1', atMs: 90_000 })
    await new AddBookmark(deps).execute({ recordingId: 'rec-1', atMs: 30_000 })

    expect(await artifacts.readBookmarks(recording)).toEqual([{ atMs: 30_000 }, { atMs: 90_000 }])
  })

  it('時刻は整数のミリ秒に丸め、負にしない', async () => {
    await new AddBookmark(deps).execute({ recordingId: 'rec-1', atMs: -5.4 })
    await new AddBookmark(deps).execute({ recordingId: 'rec-1', atMs: 1_234.6 })

    expect(await artifacts.readBookmarks(recording)).toEqual([{ atMs: 0 }, { atMs: 1_235 }])
  })

  it('存在しない録音には付けられない', async () => {
    await expect(
      new AddBookmark(deps).execute({ recordingId: 'unknown', atMs: 0 })
    ).rejects.toThrow('録音が見つかりません: unknown')
  })
})

describe('UpdateSummary', () => {
  it('手で直した要約を保存する', async () => {
    await artifacts.writeSummary(recording, '# 要約\n\n- 予算は 2 割減')
    await new UpdateSummary(deps).execute({ recordingId: 'rec-1', summary: '# 要約\n\n- 予算は 3 割減' })

    expect(await artifacts.readSummary(recording)).toBe('# 要約\n\n- 予算は 3 割減')
  })

  it('存在しない録音の要約は直せない', async () => {
    await expect(
      new UpdateSummary(deps).execute({ recordingId: 'unknown', summary: '要約' })
    ).rejects.toThrow('録音が見つかりません: unknown')
  })
})

describe('RenameRecording', () => {
  it('タイトルを変更して保存する', async () => {
    const renamed = await new RenameRecording(deps).execute({
      recordingId: 'rec-1',
      title: '週次ミーティング'
    })

    expect(renamed.title).toBe('週次ミーティング')
    expect((await repository.find('rec-1'))?.title).toBe('週次ミーティング')
  })

  it('保存ディレクトリ名は変えない（既存ファイルの場所を壊さない）', async () => {
    const renamed = await new RenameRecording(deps).execute({
      recordingId: 'rec-1',
      title: '週次ミーティング'
    })

    expect(renamed.slug).toBe(recording.slug)
  })

  it('空のタイトルは拒否する', async () => {
    await expect(
      new RenameRecording(deps).execute({ recordingId: 'rec-1', title: '   ' })
    ).rejects.toThrow('タイトルを入力してください。')
  })
})

describe('RenameSpeaker', () => {
  beforeEach(async () => {
    await artifacts.writeTranscript(recording, { segments, speakers })
  })

  it('指定した話者のラベルだけを変える', async () => {
    const updated = await new RenameSpeaker(deps).execute({
      recordingId: 'rec-1',
      speakerId: 'remote:spk0',
      label: '田中さん'
    })

    expect(updated).toEqual([
      { id: SELF_SPEAKER_ID, kind: 'self', label: '自分' },
      { id: 'remote:spk0', kind: 'remote', label: '田中さん' }
    ])
  })

  it('セグメントは書き換えない', async () => {
    await new RenameSpeaker(deps).execute({
      recordingId: 'rec-1',
      speakerId: 'remote:spk0',
      label: '田中さん'
    })

    expect((await artifacts.readTranscript(recording))?.segments).toEqual(segments)
  })

  it('空の話者名は拒否する', async () => {
    await expect(
      new RenameSpeaker(deps).execute({ recordingId: 'rec-1', speakerId: 'remote:spk0', label: ' ' })
    ).rejects.toThrow('話者名を入力してください。')
  })

  it('文字起こしがまだ無ければ拒否する', async () => {
    const other = createRecording({ id: 'rec-2', startedAt })
    await repository.save(other)

    await expect(
      new RenameSpeaker(deps).execute({ recordingId: 'rec-2', speakerId: 'self', label: 'A' })
    ).rejects.toThrow('文字起こしがまだありません。')
  })
})

describe('EditSegmentText', () => {
  beforeEach(async () => {
    await artifacts.writeTranscript(recording, { segments, speakers })
  })

  it('指定したセグメントの本文だけを書き換える', async () => {
    const updated = await new EditSegmentText(deps).execute({
      recordingId: 'rec-1',
      index: 1,
      startMs: 2000,
      text: 'よろしくお願いいたします'
    })

    expect(updated).toEqual([
      segments[0],
      { startMs: 2000, endMs: 3000, speakerId: 'remote:spk0', text: 'よろしくお願いいたします' }
    ])
    expect((await artifacts.readTranscript(recording))?.segments).toEqual(updated)
  })

  it('話者一覧は書き換えない', async () => {
    await new EditSegmentText(deps).execute({
      recordingId: 'rec-1',
      index: 0,
      startMs: 0,
      text: 'おはよう'
    })

    expect((await artifacts.readTranscript(recording))?.speakers).toEqual(speakers)
  })

  it('前後の空白は落とす', async () => {
    const updated = await new EditSegmentText(deps).execute({
      recordingId: 'rec-1',
      index: 0,
      startMs: 0,
      text: '  おはよう \n'
    })

    expect(updated[0]?.text).toBe('おはよう')
  })

  it('途中の改行は空白に畳む（transcript.md では 1 発言 1 行のため）', async () => {
    const updated = await new EditSegmentText(deps).execute({
      recordingId: 'rec-1',
      index: 0,
      startMs: 0,
      text: 'おはよう\r\n  ございます'
    })

    expect(updated[0]?.text).toBe('おはよう ございます')
  })

  it('空の本文は拒否する', async () => {
    await expect(
      new EditSegmentText(deps).execute({ recordingId: 'rec-1', index: 0, startMs: 0, text: ' ' })
    ).rejects.toThrow('本文を入力してください。')
  })

  it('画面が見ていたセグメントと開始時刻が食い違えば拒否する', async () => {
    await expect(
      new EditSegmentText(deps).execute({ recordingId: 'rec-1', index: 1, startMs: 0, text: 'x' })
    ).rejects.toThrow('文字起こしが更新されています。')
    expect((await artifacts.readTranscript(recording))?.segments).toEqual(segments)
  })

  it('範囲外の位置は拒否する', async () => {
    await expect(
      new EditSegmentText(deps).execute({ recordingId: 'rec-1', index: 2, startMs: 0, text: 'x' })
    ).rejects.toThrow('文字起こしが更新されています。')
  })

  it('話者識別の最中は拒否する（終わったときに古い本文で上書きされるため）', async () => {
    await repository.save({ ...recording, steps: startStep(recording.steps, 'diarize') })

    await expect(
      new EditSegmentText(deps).execute({ recordingId: 'rec-1', index: 0, startMs: 0, text: 'x' })
    ).rejects.toThrow('話者識別が終わるまでお待ちください。')
  })

  it('文字起こしがまだ無ければ拒否する', async () => {
    const other = createRecording({ id: 'rec-2', startedAt })
    await repository.save(other)

    await expect(
      new EditSegmentText(deps).execute({ recordingId: 'rec-2', index: 0, startMs: 0, text: 'x' })
    ).rejects.toThrow('文字起こしがまだありません。')
  })
})

describe('RememberSpeakerVoice', () => {
  const MODEL = 'fake-embedding:2'
  const voice = (degrees: number): Float32Array => {
    const radians = (degrees * Math.PI) / 180
    return normalize([Math.cos(radians), Math.sin(radians)])
  }

  let voiceprints: FakeVoiceprintRepository
  let voices: FakeVoiceExtraction
  let remember: RememberSpeakerVoice

  const rememberName = (label: string, speakerId = 'remote:spk0'): Promise<VoiceMemoryResult> =>
    remember.execute({ recordingId: 'rec-1', speakerId, label })

  beforeEach(async () => {
    await artifacts.writeTranscript(recording, { segments, speakers })
    voiceprints = new FakeVoiceprintRepository()
    voices = new FakeVoiceExtraction()
    remember = new RememberSpeakerVoice({
      ...deps,
      voiceprints,
      voices,
      clock: new FakeClock(new Date('2026-09-13T12:00:00.000Z'))
    })
    await artifacts.writeVoices(recording, {
      modelKey: MODEL,
      speakers: [{ speakerId: 'remote:spk0', vector: voice(0) }]
    })
  })

  it('付けた名前で声紋帳に登録する', async () => {
    expect(await rememberName('田中さん')).toBe('remembered')

    expect(voiceprints.entries).toEqual([
      {
        name: '田中さん',
        vector: voice(0),
        sources: [{ key: 'rec-1:remote:spk0', vector: voice(0) }],
        modelKey: MODEL,
        updatedAt: '2026-09-13T12:00:00.000Z'
      }
    ])
  })

  it('声紋が残っていれば取り直しに行かない', async () => {
    await rememberName('田中さん')

    expect(voices.calls).toEqual([])
  })

  it('声紋が無ければ取り直してから登録する', async () => {
    artifacts.voices.delete(recording.id)
    voices.onExtract = async () => {
      await artifacts.writeVoices(recording, {
        modelKey: MODEL,
        speakers: [{ speakerId: 'remote:spk0', vector: voice(0) }]
      })
    }

    expect(await rememberName('田中さん')).toBe('remembered')
    expect(voices.calls).toEqual(['rec-1'])
    expect(voiceprints.entries.map((entry) => entry.name)).toEqual(['田中さん'])
  })

  it('取り直しても声紋が得られなければ、覚えられなかったと返す', async () => {
    artifacts.voices.delete(recording.id)

    expect(await rememberName('田中さん')).toBe('unavailable')
    expect(voiceprints.entries).toEqual([])
  })

  it('取り直しが失敗したら理由をそのまま投げる', async () => {
    artifacts.voices.delete(recording.id)
    voices.error = new ConfigurationError('話者識別が無効なため、この録音から声を覚えられません。')

    await expect(rememberName('田中さん')).rejects.toThrow('話者識別が無効なため')
  })

  it('別の録音で同じ名前を付けると声紋を平均し、出所が増える', async () => {
    await voiceprints.put({
      name: '田中さん',
      vector: voice(90),
      sources: [{ key: 'rec-9:remote:spk0', vector: voice(90) }],
      modelKey: MODEL,
      updatedAt: '2026-01-01T00:00:00.000Z'
    })

    await rememberName('田中さん')

    expect(voiceprints.entries[0]?.sources).toHaveLength(2)
    expect(voiceprints.entries[0]?.vector[0]).toBeCloseTo(Math.SQRT1_2, 5)
  })

  it('付け直すと古い名前の声紋を取り消す（同じ声が 2 つの名前で残らない）', async () => {
    await rememberName('田中さん')
    await rememberName('佐藤さん')

    expect(voiceprints.entries.map((entry) => entry.name)).toEqual(['佐藤さん'])
  })

  it('同じ録音の同じ話者に何度付け直しても、学習の数は増えない', async () => {
    for (const label of ['田中さん', '佐藤さん', '田中さん']) {
      await rememberName(label)
    }

    expect(voiceprints.entries.map((entry) => [entry.name, entry.sources.length])).toEqual([
      ['田中さん', 1]
    ])
  })

  it('別の録音からも覚えた名前は、1 つの出所を取り消しても残る', async () => {
    await voiceprints.put({
      name: '田中さん',
      vector: voice(0),
      sources: [
        { key: 'rec-9:remote:spk0', vector: voice(0) },
        { key: 'rec-1:remote:spk0', vector: voice(0) }
      ],
      modelKey: MODEL,
      updatedAt: '2026-01-01T00:00:00.000Z'
    })

    await rememberName('佐藤さん')

    expect(
      voiceprints.entries.map((entry) => [entry.name, entry.sources.map((s) => s.key)])
    ).toEqual([
      ['田中さん', ['rec-9:remote:spk0']],
      ['佐藤さん', ['rec-1:remote:spk0']]
    ])
  })

  it('自分の呼び名は声紋帳に登録せず、取り直しにも行かない', async () => {
    expect(await rememberName('私', SELF_SPEAKER_ID)).toBe('skipped-self')

    expect(voiceprints.entries).toEqual([])
    expect(voices.calls).toEqual([])
  })
})

describe('DeleteRecording', () => {
  it('成果物とメタデータの両方を消す', async () => {
    await new DeleteRecording(deps).execute('rec-1')

    expect(artifacts.removed).toEqual(['rec-1'])
    expect(await repository.list()).toEqual([])
  })

  it('存在しない録音は削除できない', async () => {
    await expect(new DeleteRecording(deps).execute('unknown')).rejects.toThrow(
      '録音が見つかりません: unknown'
    )
  })
})

describe('UpdateSettings', () => {
  it('部分更新を保存する', async () => {
    const settings = new FakeSettingsRepository()

    const updated = await new UpdateSettings(settings).execute({
      storageDir: '/Users/me/Meetings'
    })

    expect(updated.storageDir).toBe('/Users/me/Meetings')
  })

  it('保存前に検証し、不正な値は保存しない', async () => {
    const settings = new FakeSettingsRepository()

    await expect(
      new UpdateSettings(settings).execute({ audio: { sampleRate: 12_345 } })
    ).rejects.toThrow('サンプルレートは')
    expect((await settings.load()).audio.sampleRate).toBe(16_000)
  })

  it('録音の設定も検証の対象にする', async () => {
    const settings = new FakeSettingsRepository()

    await expect(
      new UpdateSettings(settings).execute({ recording: { silenceDurationMs: 0 } })
    ).rejects.toThrow('無音を知らせるまでの時間は')
    expect((await settings.load()).recording.silenceDurationMs).toBe(300_000)
  })

  it('要約プロンプトから差し込み位置を消す変更を拒否する', async () => {
    const settings = new FakeSettingsRepository()

    await expect(
      new UpdateSettings(settings).execute({ summarization: { promptTemplate: '要約して' } })
    ).rejects.toThrow('{{transcript}}')
  })
})

describe('GetSetupState', () => {
  it('保存先もモデルも未設定なら初期設定が必要と伝える', async () => {
    const state = await new GetSetupState(new FakeSettingsRepository(defaultSettings())).execute()

    expect(state.needsStorageDir).toBe(true)
    expect(state.needsTranscriptionModel).toBe(true)
    expect(state.needsSummarizationModel).toBe(true)
  })

  it('揃っていれば初期設定は不要と伝える', async () => {
    const settings = new FakeSettingsRepository({
      ...defaultSettings(),
      storageDir: '/storage',
      transcription: { ...defaultSettings().transcription, modelPath: '/m/whisper.bin' },
      summarization: { ...defaultSettings().summarization, modelPath: '/m/qwen.gguf' }
    })

    const state = await new GetSetupState(settings).execute()

    expect(state.needsStorageDir).toBe(false)
    expect(state.needsTranscriptionModel).toBe(false)
    expect(state.needsSummarizationModel).toBe(false)
  })
})

describe('声紋帳の管理', () => {
  const print = (name: string, updatedAt: string, sources = 1): Voiceprint => ({
    name,
    vector: Float32Array.from([1, 0]),
    sources: Array.from({ length: sources }, (_, index) => ({
      key: `rec-${index}:remote:spk0`,
      vector: Float32Array.from([1, 0])
    })),
    modelKey: 'campplus:192',
    updatedAt
  })

  let voiceprints: FakeVoiceprintRepository

  beforeEach(async () => {
    voiceprints = new FakeVoiceprintRepository()
    await voiceprints.put(print('田中さん', '2026-09-10T00:00:00.000Z', 3))
    await voiceprints.put(print('佐藤さん', '2026-09-12T00:00:00.000Z'))
  })

  it('ベクトルを外に出さず、新しい順に並べて返す', async () => {
    const listed = await new ListVoiceprints(voiceprints).execute()

    expect(listed).toEqual([
      { name: '佐藤さん', samples: 1, updatedAt: '2026-09-12T00:00:00.000Z' },
      { name: '田中さん', samples: 3, updatedAt: '2026-09-10T00:00:00.000Z' }
    ])
  })

  it('名前を指定して 1 件だけ消せる', async () => {
    await new RemoveVoiceprint(voiceprints).execute('田中さん')

    expect((await voiceprints.list()).map((entry) => entry.name)).toEqual(['佐藤さん'])
  })

  it('全部消せる', async () => {
    await new ClearVoiceprints(voiceprints).execute()

    expect(await voiceprints.list()).toEqual([])
  })
})
