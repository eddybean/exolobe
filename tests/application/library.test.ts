import { beforeEach, describe, expect, it } from 'vitest'
import {
  DeleteRecording,
  GetRecordingDetail,
  GetSetupState,
  ListRecordings,
  RenameRecording,
  RenameSpeaker,
  UpdateNote,
  UpdateSettings
} from '@application/usecases/library'
import { createRecording } from '@domain/Recording'
import { defaultSettings } from '@domain/Settings'
import { SELF_SPEAKER_ID, type Speaker } from '@domain/Speaker'
import {
  FakeArtifactStore,
  FakeClock,
  FakeRecordingRepository,
  FakeSettingsRepository,
  FakeVoiceprintRepository
} from './fakes'
import { normalize } from '@domain/vector'

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
  const MODEL = 'fake-embedding:2'
  const voice = (degrees: number): Float32Array => {
    const radians = (degrees * Math.PI) / 180
    return normalize([Math.cos(radians), Math.sin(radians)])
  }

  let voiceprints: FakeVoiceprintRepository
  let renameDeps: typeof deps & {
    voiceprints: FakeVoiceprintRepository
    clock: FakeClock
  }

  beforeEach(async () => {
    await artifacts.writeTranscript(recording, { segments, speakers })
    voiceprints = new FakeVoiceprintRepository()
    renameDeps = {
      ...deps,
      voiceprints,
      clock: new FakeClock(new Date('2026-09-13T12:00:00.000Z'))
    }
    await artifacts.writeVoices(recording, {
      modelKey: MODEL,
      speakers: [{ speakerId: 'remote:spk0', vector: voice(0) }]
    })
  })

  it('指定した話者のラベルだけを変える', async () => {
    const updated = await new RenameSpeaker(renameDeps).execute({
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
    await new RenameSpeaker(renameDeps).execute({
      recordingId: 'rec-1',
      speakerId: 'remote:spk0',
      label: '田中さん'
    })

    expect((await artifacts.readTranscript(recording))?.segments).toEqual(segments)
  })

  it('付けた名前で声紋帳に登録する', async () => {
    await new RenameSpeaker(renameDeps).execute({
      recordingId: 'rec-1',
      speakerId: 'remote:spk0',
      label: '田中さん'
    })

    expect(voiceprints.entries).toEqual([
      {
        name: '田中さん',
        vector: voice(0),
        samples: 1,
        modelKey: MODEL,
        updatedAt: '2026-09-13T12:00:00.000Z'
      }
    ])
  })

  it('同じ名前を付け直すと声紋を平均し、回数を増やす', async () => {
    await voiceprints.put({
      name: '田中さん',
      vector: voice(90),
      samples: 1,
      modelKey: MODEL,
      updatedAt: '2026-01-01T00:00:00.000Z'
    })

    await new RenameSpeaker(renameDeps).execute({
      recordingId: 'rec-1',
      speakerId: 'remote:spk0',
      label: '田中さん'
    })

    expect(voiceprints.entries[0]?.samples).toBe(2)
    expect(voiceprints.entries[0]?.vector[0]).toBeCloseTo(Math.SQRT1_2, 5)
  })

  it('声紋が残っていない録音では、名前だけを変える', async () => {
    artifacts.voices.delete(recording.id)

    const updated = await new RenameSpeaker(renameDeps).execute({
      recordingId: 'rec-1',
      speakerId: 'remote:spk0',
      label: '田中さん'
    })

    expect(updated[1]?.label).toBe('田中さん')
    expect(voiceprints.entries).toEqual([])
  })

  it('自分の呼び名を変えても声紋帳には登録しない', async () => {
    await new RenameSpeaker(renameDeps).execute({
      recordingId: 'rec-1',
      speakerId: SELF_SPEAKER_ID,
      label: '私'
    })

    expect(voiceprints.entries).toEqual([])
  })

  it('空の話者名は拒否する', async () => {
    await expect(
      new RenameSpeaker(renameDeps).execute({ recordingId: 'rec-1', speakerId: 'remote:spk0', label: ' ' })
    ).rejects.toThrow('話者名を入力してください。')
  })

  it('文字起こしがまだ無ければ拒否する', async () => {
    const other = createRecording({ id: 'rec-2', startedAt })
    await repository.save(other)

    await expect(
      new RenameSpeaker(renameDeps).execute({ recordingId: 'rec-2', speakerId: 'self', label: 'A' })
    ).rejects.toThrow('文字起こしがまだありません。')
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
