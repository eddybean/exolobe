import { beforeEach, describe, expect, it } from 'vitest'
import { ProcessRecording } from '@application/usecases/ProcessRecording'
import { PIPELINE_STEPS, createRecording, finishRecording, type Recording } from '@domain/Recording'
import type { SummarizationPort } from '@application/ports'
import { SELF_SPEAKER_ID } from '@domain/Speaker'
import { mergeSettings, type SettingsPatch } from '@domain/Settings'
import {
  FakeArtifactStore,
  FakeDiarizer,
  FakeEncoder,
  FakeMixer,
  FakeProgressReporter,
  FakeRecordingRepository,
  FakeSettingsRepository,
  FakeSummarizer,
  FakeSystemResource,
  FakeTranscriber
} from './fakes'

const startedAt = new Date('2026-09-06T14:30:00+09:00')

const tracks = {
  kind: 'dual' as const,
  systemWavPath: '/work/rec-1/system.wav',
  micWavPath: '/work/rec-1/mic.wav',
  micOffsetMs: 120,
  durationMs: 65_000
}

const build = async (
  settingsPatch: SettingsPatch = {},
  options: { durationMs?: number } = {}
) => {
  const repository = new FakeRecordingRepository()
  const artifacts = new FakeArtifactStore()
  const settingsRepo = new FakeSettingsRepository(
    mergeSettings(await new FakeSettingsRepository().load(), settingsPatch)
  )
  const transcriber = new FakeTranscriber()
  const diarizer = new FakeDiarizer()
  const summarizer = new FakeSummarizer()
  const mixer = new FakeMixer()
  const encoder = new FakeEncoder()
  const progress = new FakeProgressReporter()
  const system = new FakeSystemResource()

  const recording = finishRecording(
    createRecording({ id: 'rec-1', startedAt }),
    options.durationMs ?? 65_000
  )
  await repository.save(recording)
  await artifacts.writeTracks(recording, tracks)

  transcriber.byPath.set(tracks.micWavPath, [{ startMs: 0, endMs: 1000, text: 'おはようございます' }])
  transcriber.byPath.set(tracks.systemWavPath, [
    { startMs: 1500, endMs: 2500, text: 'よろしくお願いします' },
    { startMs: 5000, endMs: 6000, text: '本題に入ります' }
  ])

  const deps = {
    settings: settingsRepo,
    repository,
    artifacts,
    mixer,
    transcriber,
    diarizer,
    summarizer,
    encoder,
    progress,
    system
  }

  return { ...deps, recording, process: new ProcessRecording(deps) }
}

describe('ProcessRecording — 正常系', () => {
  let ctx: Awaited<ReturnType<typeof build>>

  beforeEach(async () => {
    ctx = await build()
  })

  it('全ステップを完了し ready になる', async () => {
    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(result.status).toBe('ready')
    expect(PIPELINE_STEPS.every((step) => result.steps[step].status === 'done')).toBe(true)
  })

  it('2 トラックをオフセット付きでミックスする', async () => {
    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.mixer.calls[0]?.tracks).toEqual([
      { path: tracks.systemWavPath, offsetMs: 0 },
      { path: tracks.micWavPath, offsetMs: 120 }
    ])
  })

  it('マイクは自分・システム音声は相手として文字起こしする', async () => {
    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.transcriber.calls).toEqual([
      { wavPath: tracks.micWavPath, speakerId: 'self' },
      { wavPath: tracks.systemWavPath, speakerId: 'remote' }
    ])
  })

  it('文字起こしを時系列順にマージして保存する', async () => {
    await ctx.process.execute({ recordingId: 'rec-1' })
    const saved = await ctx.artifacts.readTranscript(ctx.recording)

    expect(saved?.segments.map((s) => [s.speakerId, s.text])).toEqual([
      [SELF_SPEAKER_ID, 'おはようございます'],
      ['remote', 'よろしくお願いします'],
      ['remote', '本題に入ります']
    ])
  })

  it('話者クラスタリングの結果を反映し、参加者ラベルを採番する', async () => {
    ctx.diarizer.turns = [
      { startMs: 1000, endMs: 3000, speaker: 'spk0' },
      { startMs: 4500, endMs: 6500, speaker: 'spk1' }
    ]
    await ctx.process.execute({ recordingId: 'rec-1' })
    const saved = await ctx.artifacts.readTranscript(ctx.recording)

    expect(saved?.segments.map((s) => s.speakerId)).toEqual([
      SELF_SPEAKER_ID,
      'remote:spk0',
      'remote:spk1'
    ])
    expect(saved?.speakers).toEqual([
      { id: SELF_SPEAKER_ID, kind: 'self', label: '自分' },
      { id: 'remote:spk0', kind: 'remote', label: '参加者A' },
      { id: 'remote:spk1', kind: 'remote', label: '参加者B' }
    ])
  })

  it('要約には話者ラベル付きの Markdown を渡す', async () => {
    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.summarizer.receivedTranscript).toContain('**[00:00] 自分**')
    expect(ctx.summarizer.receivedTranscript).toContain('おはようございます')
  })

  it('ミックス済み WAV を設定のビットレートでエンコードする', async () => {
    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.encoder.calls[0]).toEqual({
      inputPath: '/work/rec-1/mix.wav',
      outputPath: await ctx.artifacts.audioPath(ctx.recording),
      codec: 'aac',
      bitrateKbps: 32
    })
  })

  it('全ステップ成功したときだけ中間ファイルを片付ける', async () => {
    await ctx.process.execute({ recordingId: 'rec-1' })
    expect(ctx.artifacts.cleanedUp).toEqual(['rec-1'])
  })

  it('各ステップの開始と完了を進捗として通知する', async () => {
    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.progress.events.filter((e) => e.step === 'transcribe')).toEqual([
      { recordingId: 'rec-1', step: 'transcribe', status: 'running' },
      { recordingId: 'rec-1', step: 'transcribe', status: 'done' }
    ])
  })

  it('ステップごとに状態を永続化する', async () => {
    await ctx.process.execute({ recordingId: 'rec-1' })
    expect((await ctx.repository.find('rec-1'))?.status).toBe('ready')
  })
})

describe('ProcessRecording — 話者クラスタリング無効', () => {
  it('diarize をスキップして done 扱いにする', async () => {
    const ctx = await build({ diarization: { enabled: false } })
    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.diarizer.calls).toBe(0)
    expect(result.steps.diarize.status).toBe('done')
    expect(result.status).toBe('ready')
  })
})

describe('ProcessRecording — 失敗時の切り分け', () => {
  it('要約が失敗してもエンコードは実行し、音声は残す', async () => {
    const ctx = await build()
    ctx.summarizer.error = new Error('要約モデルが読み込めません')

    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(result.steps.summarize).toEqual({
      status: 'failed',
      error: '要約モデルが読み込めません'
    })
    expect(result.steps.encode.status).toBe('done')
    expect(ctx.encoder.calls).toHaveLength(1)
    expect(result.status).toBe('failed')
  })

  it('失敗が残っている間は中間ファイルを消さない', async () => {
    const ctx = await build()
    ctx.summarizer.error = new Error('要約モデルが読み込めません')

    await ctx.process.execute({ recordingId: 'rec-1' })
    expect(ctx.artifacts.cleanedUp).toEqual([])
  })

  it('文字起こしが失敗したら依存する話者識別と要約は実行しない', async () => {
    const ctx = await build()
    ctx.transcriber.error = new Error('whisper-cli が見つかりません')

    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(result.steps.transcribe.status).toBe('failed')
    expect(result.steps.diarize.status).toBe('failed')
    expect(result.steps.diarize.error).toBe('前のステップ（文字起こし）が失敗したため実行しませんでした。')
    expect(result.steps.summarize.status).toBe('failed')
    expect(ctx.diarizer.calls).toBe(0)
  })

  it('ミックスが失敗したらエンコードも実行しない', async () => {
    const ctx = await build()
    ctx.mixer.error = new Error('WAV を読み込めません')

    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(result.steps.encode.status).toBe('failed')
    expect(ctx.encoder.calls).toHaveLength(0)
    // ミックスに依存しない文字起こしは実行される
    expect(result.steps.transcribe.status).toBe('done')
  })

  it('話者識別だけ失敗しても文字起こしと要約は残る', async () => {
    const ctx = await build()
    ctx.diarizer.error = new Error('話者識別モデルが見つかりません')

    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(result.steps.diarize.status).toBe('failed')
    expect(result.steps.summarize.status).toBe('done')
    expect(await ctx.artifacts.readSummary(ctx.recording)).toBeDefined()
  })

  it('トラック情報が無ければ処理を開始できない', async () => {
    const ctx = await build()
    ctx.artifacts.tracks.clear()

    await expect(ctx.process.execute({ recordingId: 'rec-1' })).rejects.toThrow(
      '録音データが見つかりません。'
    )
  })

  it('存在しない録音は処理できない', async () => {
    const ctx = await build()
    await expect(ctx.process.execute({ recordingId: 'unknown' })).rejects.toThrow(
      '録音が見つかりません: unknown'
    )
  })
})

describe('ProcessRecording — 個別リトライ', () => {
  it('指定したステップだけを再実行する', async () => {
    const ctx = await build()
    ctx.summarizer.error = new Error('要約モデルが読み込めません')
    await ctx.process.execute({ recordingId: 'rec-1' })

    ctx.summarizer.clearError()
    ctx.transcriber.calls.length = 0

    const result = await ctx.process.execute({ recordingId: 'rec-1', only: ['summarize'] })

    expect(ctx.transcriber.calls).toHaveLength(0)
    expect(result.steps.summarize.status).toBe('done')
    expect(result.status).toBe('ready')
  })

  it('リトライで全ステップが揃えば中間ファイルを片付ける', async () => {
    const ctx = await build()
    ctx.summarizer.error = new Error('要約モデルが読み込めません')
    await ctx.process.execute({ recordingId: 'rec-1' })
    ctx.summarizer.clearError()

    await ctx.process.execute({ recordingId: 'rec-1', only: ['summarize'] })
    expect(ctx.artifacts.cleanedUp).toEqual(['rec-1'])
  })
})

describe('ProcessRecording — 短すぎる録音', () => {
  const tooShort = '録音時間が 12 秒しかありません。1 分未満の録音は処理しません。'

  it('ミックスも文字起こしもせず、全ステップを同じ理由で失敗にする', async () => {
    const ctx = await build({}, { durationMs: 12_000 })

    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.mixer.calls).toHaveLength(0)
    expect(ctx.transcriber.calls).toHaveLength(0)
    expect(result.status).toBe('failed')
    expect(PIPELINE_STEPS.map((step) => result.steps[step].error)).toEqual(
      PIPELINE_STEPS.map(() => tooShort)
    )
  })

  it('中間ファイルを片付ける（やり直しても結果は変わらない）', async () => {
    const ctx = await build({}, { durationMs: 12_000 })

    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.artifacts.cleanedUp).toEqual(['rec-1'])
  })

  it('個別リトライも同じ理由で断る（トラックが無いとは言わない）', async () => {
    const ctx = await build({}, { durationMs: 12_000 })
    await ctx.process.execute({ recordingId: 'rec-1' })

    const retried = await ctx.process.execute({ recordingId: 'rec-1', only: ['summarize'] })

    expect(retried.steps.summarize.error).toBe(tooShort)
    expect(ctx.summarizer.receivedTranscript).toBeUndefined()
  })

  it('全ステップの失敗を進捗として通知する', async () => {
    const ctx = await build({}, { durationMs: 12_000 })

    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.progress.events).toEqual(
      PIPELINE_STEPS.map((step) => ({
        recordingId: 'rec-1',
        step,
        status: 'failed',
        error: tooShort
      }))
    )
  })

  it('1 分以上あれば通常どおり処理する', async () => {
    const ctx = await build({}, { durationMs: 60_000 })

    expect((await ctx.process.execute({ recordingId: 'rec-1' })).status).toBe('ready')
  })
})

describe('ProcessRecording — 利用者が付けた話者名', () => {
  /** 詳細画面で話者名を変えた状況を作る。 */
  const rename = async (
    ctx: Awaited<ReturnType<typeof build>>,
    speakerId: string,
    label: string
  ): Promise<void> => {
    const saved = await ctx.artifacts.readTranscript(ctx.recording)
    await ctx.artifacts.writeTranscript(ctx.recording, {
      segments: saved?.segments ?? [],
      speakers: (saved?.speakers ?? []).map((speaker) =>
        speaker.id === speakerId ? { ...speaker, label } : speaker
      )
    })
  }

  it('話者識別を再実行しても付けた名前を引き継ぐ', async () => {
    const ctx = await build()
    ctx.diarizer.turns = [
      { startMs: 1000, endMs: 3000, speaker: 'spk0' },
      { startMs: 4500, endMs: 6500, speaker: 'spk1' }
    ]
    await ctx.process.execute({ recordingId: 'rec-1' })
    await rename(ctx, 'remote:spk0', '田中さん')

    await ctx.process.execute({ recordingId: 'rec-1', only: ['diarize'] })

    expect((await ctx.artifacts.readTranscript(ctx.recording))?.speakers).toEqual([
      { id: SELF_SPEAKER_ID, kind: 'self', label: '自分' },
      { id: 'remote:spk0', kind: 'remote', label: '田中さん' },
      { id: 'remote:spk1', kind: 'remote', label: '参加者B' }
    ])
  })

  it('文字起こしを再実行しても付けた名前を引き継ぐ', async () => {
    const ctx = await build()
    await ctx.process.execute({ recordingId: 'rec-1' })
    await rename(ctx, SELF_SPEAKER_ID, '私')

    await ctx.process.execute({ recordingId: 'rec-1', only: ['transcribe'] })

    expect((await ctx.artifacts.readTranscript(ctx.recording))?.speakers).toContainEqual({
      id: SELF_SPEAKER_ID,
      kind: 'self',
      label: '私'
    })
  })

  it('要約だけ再実行すると、変更後の話者名で要約し直す', async () => {
    const ctx = await build()
    await ctx.process.execute({ recordingId: 'rec-1' })
    await rename(ctx, SELF_SPEAKER_ID, '田中')

    const result = await ctx.process.execute({ recordingId: 'rec-1', only: ['summarize'] })

    expect(ctx.summarizer.receivedTranscript).toContain('**[00:00] 田中**')
    expect(result.steps.summarize.status).toBe('done')
  })
})

describe('ProcessRecording — 処理中の利用者の編集', () => {
  /**
   * パイプラインは数分走るため、その間に利用者はフォルダ移動やリネームをする。
   * 開始時のスナップショットを丸ごと書き戻すと、その編集が巻き戻ってしまう。
   * 要約ステップの最中に編集が入った状況を再現する。
   */
  const buildWithEditDuringSummarize = async (
    edit: (recording: Recording) => Recording
  ): Promise<{ ctx: Awaited<ReturnType<typeof build>>; process: ProcessRecording }> => {
    const ctx = await build()
    const summarizer: SummarizationPort = {
      summarize: async () => {
        const current = await ctx.repository.find('rec-1')
        await ctx.repository.save(edit(current as Recording))
        return '## 概要\nテスト要約'
      }
    }

    return {
      ctx,
      process: new ProcessRecording({
        settings: ctx.settings,
        repository: ctx.repository,
        artifacts: ctx.artifacts,
        mixer: ctx.mixer,
        system: ctx.system,
        transcriber: ctx.transcriber,
        diarizer: ctx.diarizer,
        summarizer,
        encoder: ctx.encoder,
        progress: ctx.progress
      })
    }
  }

  it('フォルダへ移動されたら、その分類を保ったまま完了する', async () => {
    const { ctx, process } = await buildWithEditDuringSummarize((recording) => ({
      ...recording,
      folderId: 'folder-1'
    }))

    const result = await process.execute({ recordingId: 'rec-1' })

    expect(result.folderId).toBe('folder-1')
    expect((await ctx.repository.find('rec-1'))?.folderId).toBe('folder-1')
  })

  it('タイトルを変更されたら、その名前を保ったまま完了する', async () => {
    const { ctx, process } = await buildWithEditDuringSummarize((recording) => ({
      ...recording,
      title: '定例ミーティング'
    }))

    const result = await process.execute({ recordingId: 'rec-1' })

    expect(result.title).toBe('定例ミーティング')
    expect((await ctx.repository.find('rec-1'))?.title).toBe('定例ミーティング')
  })
})

describe('ProcessRecording — メモリガード', () => {
  const GB = 1_024 ** 3
  /** 既定モデルの実サイズ相当。要約に約 7GB を要する。 */
  const GEMMA_BYTES = 5_154_941_280
  const modelPath = '/models/gemma.gguf'

  const buildWithModels = async (patch: SettingsPatch = {}) => {
    const ctx = await build({ summarization: { modelPath }, ...patch })
    ctx.system.sizes.set(modelPath, GEMMA_BYTES)
    return ctx
  }

  it('空きが足りなければ要約を実行せず失敗として記録する', async () => {
    const ctx = await buildWithModels()
    ctx.system.snapshot = { totalBytes: 16 * GB, availableBytes: 2 * GB }

    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(result.steps.summarize.status).toBe('failed')
    expect(result.steps.summarize.error).toContain('メモリが不足')
    // モデルに触れる前に止めるのが目的。要約自体は呼ばれない。
    expect(ctx.summarizer.receivedTranscript).toBeUndefined()
  })

  it('要約を止めても音声の成果物は残す', async () => {
    const ctx = await buildWithModels()
    ctx.system.snapshot = { totalBytes: 16 * GB, availableBytes: 2 * GB }

    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    // ADR-010: 独立したステップは巻き添えにしない。
    expect(result.steps.mix.status).toBe('done')
    expect(result.steps.encode.status).toBe('done')
    expect(result.steps.transcribe.status).toBe('done')
  })

  it('メモリ保護がオフなら空きが少なくても実行する', async () => {
    const ctx = await buildWithModels({ memoryProtection: 'off' })
    ctx.system.snapshot = { totalBytes: 16 * GB, availableBytes: 0 }

    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(result.steps.summarize.status).toBe('done')
  })

  it('空きが十分なら従来どおり実行する', async () => {
    const ctx = await buildWithModels()

    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(result.status).toBe('ready')
    expect(result.steps.summarize.status).toBe('done')
  })

  it('止めた理由を進捗として通知する', async () => {
    const ctx = await buildWithModels()
    ctx.system.snapshot = { totalBytes: 16 * GB, availableBytes: 2 * GB }

    await ctx.process.execute({ recordingId: 'rec-1' })

    const failed = ctx.progress.events.find(
      (event) => event.step === 'summarize' && event.status === 'failed'
    )
    expect(failed?.error).toContain('メモリが不足')
  })

  it('モデルの実サイズが読めなければカタログ値で見積もる', async () => {
    const ctx = await build({ summarization: { modelPath } })
    // sizes に登録しない = stat に失敗した状況。
    ctx.system.snapshot = { totalBytes: 16 * GB, availableBytes: 2 * GB }

    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(result.steps.summarize.status).toBe('failed')
  })

  it('要約だけを再実行するときも判定する', async () => {
    const ctx = await buildWithModels()
    ctx.system.snapshot = { totalBytes: 16 * GB, availableBytes: 2 * GB }

    const result = await ctx.process.execute({ recordingId: 'rec-1', only: ['summarize'] })

    expect(result.steps.summarize.status).toBe('failed')
  })
})
