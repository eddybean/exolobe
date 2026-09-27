import { beforeEach, describe, expect, it } from 'vitest'
import { ProcessRecording } from '@application/usecases/ProcessRecording'
import { PIPELINE_STEPS, createRecording, finishRecording, type Recording } from '@domain/Recording'
import type { SummarizationPort } from '@application/ports'
import { SELF_SPEAKER_ID } from '@domain/Speaker'
import { normalize } from '@domain/vector'
import { mergeSettings, type SettingsPatch } from '@domain/Settings'
import {
  FakeArtifactStore,
  FakeDiarizer,
  FakeSpeakerEmbedder,
  FakeEncoder,
  FakeMixer,
  FakeProgressReporter,
  FakeRecordingRepository,
  FakeSettingsRepository,
  FakeSummarizer,
  FakeSystemResource,
  FakeTranscriber,
  FakeVoiceprintRepository
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
  const embedder = new FakeSpeakerEmbedder()
  const voiceprints = new FakeVoiceprintRepository()
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
    embedder,
    voiceprints,
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

  it('文字起こしの進捗を、全トラックを通した割合で通知する', async () => {
    // トラックは直列に起こすので、1 本目が終わった時点で全体の半分になる。
    ctx.transcriber.progressByPath.set(tracks.micWavPath, [0.5, 1])
    ctx.transcriber.progressByPath.set(tracks.systemWavPath, [0.5, 1])

    await ctx.process.execute({ recordingId: 'rec-1' })

    const fractions = ctx.progress.events
      .filter((e) => e.step === 'transcribe' && e.fraction !== undefined)
      .map((e) => e.fraction)
    expect(fractions).toEqual([0.25, 0.5, 0.75, 1])
  })

  it('ステップごとに状態を永続化する', async () => {
    await ctx.process.execute({ recordingId: 'rec-1' })
    expect((await ctx.repository.find('rec-1'))?.status).toBe('ready')
  })
})

describe('ProcessRecording — 会議中のメモと印（ADR-042）', () => {
  it('メモと、印を押した時点の発言を要約に渡す', async () => {
    const ctx = await build()
    await ctx.artifacts.writeNote(ctx.recording, '- [00:00:01] 挨拶の確認')
    await ctx.artifacts.writeBookmarks(ctx.recording, [{ atMs: 2_000 }])

    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.summarizer.receivedNotes).toContain('- [00:00:01] 挨拶の確認')
    expect(ctx.summarizer.receivedNotes).toContain('参加者「よろしくお願いします」')
  })

  it('メモも印も無ければ空のメモを渡す', async () => {
    const ctx = await build()

    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.summarizer.receivedNotes).toBe('')
  })

  it('再要約では、録音後に書き足したメモも読み直す', async () => {
    const ctx = await build()
    await ctx.process.execute({ recordingId: 'rec-1' })
    await ctx.artifacts.writeNote(ctx.recording, '後から書いた論点')

    await ctx.process.execute({ recordingId: 'rec-1', only: ['summarize'] })

    expect(ctx.summarizer.receivedNotes).toContain('後から書いた論点')
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

  it('要約だけが失敗したなら中間ファイルは片付ける', async () => {
    const ctx = await build()
    ctx.summarizer.error = new Error('要約モデルが読み込めません')

    await ctx.process.execute({ recordingId: 'rec-1' })
    expect(ctx.artifacts.cleanedUp).toEqual(['rec-1'])
  })

  it('文字起こしが失敗したら中間ファイルは残す', async () => {
    const ctx = await build()
    ctx.transcriber.error = new Error('whisper-cli が見つかりません')

    await ctx.process.execute({ recordingId: 'rec-1' })
    expect(ctx.artifacts.cleanedUp).toEqual([])
  })

  it('エンコードが失敗したら中間ファイルは残す', async () => {
    const ctx = await build()
    ctx.encoder.error = new Error('afconvert が見つかりません')

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

  it('中間ファイルを片付けた後でも要約は再実行できる（要約はトラックを読まない）', async () => {
    const ctx = await build()
    ctx.summarizer.error = new Error('要約モデルが読み込めません')
    await ctx.process.execute({ recordingId: 'rec-1' })
    expect(ctx.artifacts.tracks.has('rec-1')).toBe(false)
    ctx.summarizer.clearError()

    const result = await ctx.process.execute({ recordingId: 'rec-1', only: ['summarize'] })

    expect(result.steps.summarize.status).toBe('done')
    expect(result.status).toBe('ready')
  })

  it('中間ファイルを片付けた後にトラックを読むステップを再実行すると、録音データが無いと断る', async () => {
    const ctx = await build()
    await ctx.process.execute({ recordingId: 'rec-1' })

    await expect(
      ctx.process.execute({ recordingId: 'rec-1', only: ['transcribe'] })
    ).rejects.toThrow('録音データが見つかりません。')
  })

  it('リトライで中間ファイルを使うステップが揃えば片付ける', async () => {
    const ctx = await build()
    ctx.transcriber.error = new Error('whisper-cli が見つかりません')
    await ctx.process.execute({ recordingId: 'rec-1' })
    expect(ctx.artifacts.cleanedUp).toEqual([])
    ctx.transcriber.clearError()

    await ctx.process.execute({
      recordingId: 'rec-1',
      only: ['transcribe', 'diarize', 'summarize']
    })
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

    // 中間 WAV が残っている（どこかのステップが失敗した）状況での再実行。
    await ctx.artifacts.writeTracks(ctx.recording, tracks)
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

    // 中間 WAV が残っている（どこかのステップが失敗した）状況での再実行。
    await ctx.artifacts.writeTracks(ctx.recording, tracks)
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
        embedder: ctx.embedder,
        voiceprints: ctx.voiceprints,
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

/**
 * 取り込んだ音声は 1 本しかなく、誰の声かが確定していない。全体を相手側として扱い、
 * 人数の分離は話者識別に任せる（ADR-030）。
 */
describe('ProcessRecording — 取り込んだ音声の処理', () => {
  const imported = {
    kind: 'single' as const,
    wavPath: '/work/rec-1/imported.wav',
    durationMs: 65_000
  }

  const buildImported = async () => {
    const ctx = await build()
    await ctx.artifacts.writeTracks(ctx.recording, imported)
    ctx.transcriber.byPath.clear()
    ctx.transcriber.byPath.set(imported.wavPath, [
      { startMs: 0, endMs: 1_000, text: 'おはようございます' },
      { startMs: 2_000, endMs: 3_000, text: 'では始めます' }
    ])
    ctx.transcriber.calls.length = 0
    return ctx
  }

  it('ミックスには 1 本だけを渡す', async () => {
    const ctx = await buildImported()
    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.mixer.calls[0]?.tracks).toEqual([{ path: imported.wavPath, offsetMs: 0 }])
  })

  it('相手側として 1 回だけ文字起こしする', async () => {
    const ctx = await buildImported()
    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.transcriber.calls).toEqual([{ wavPath: imported.wavPath, speakerId: 'remote' }])
  })

  it('自分として文字起こししない', async () => {
    const ctx = await buildImported()
    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.transcriber.calls.some((call) => call.speakerId === SELF_SPEAKER_ID)).toBe(false)
  })

  it('話者識別は音声全体にかける', async () => {
    const ctx = await buildImported()
    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.diarizer.lastWavPath).toBe(imported.wavPath)
  })

  it('話者識別の結果を参加者として採番し、「自分」を作らない', async () => {
    const ctx = await buildImported()
    ctx.diarizer.turns = [
      { startMs: 0, endMs: 1_500, speaker: 'spk0' },
      { startMs: 1_800, endMs: 3_500, speaker: 'spk1' }
    ]

    await ctx.process.execute({ recordingId: 'rec-1' })
    const saved = await ctx.artifacts.readTranscript(ctx.recording)

    expect(saved?.speakers).toEqual([
      { id: 'remote:spk0', kind: 'remote', label: '参加者A' },
      { id: 'remote:spk1', kind: 'remote', label: '参加者B' }
    ])
  })

  it('全ステップを完了し、中間ファイルを片付ける', async () => {
    const ctx = await buildImported()
    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(result.status).toBe('ready')
    expect(ctx.artifacts.cleanedUp).toEqual(['rec-1'])
  })
})

describe('ProcessRecording — 声紋による話者名の自動適用', () => {
  /** 2 次元で「声」を作る。角度が近いほど似た声。 */
  const voice = (degrees: number): Float32Array => {
    const radians = (degrees * Math.PI) / 180
    return normalize([Math.cos(radians), Math.sin(radians)])
  }

  const withVoices = async (patch: SettingsPatch = {}) => {
    const ctx = await build(patch)
    ctx.diarizer.turns = [
      { startMs: 1000, endMs: 3000, speaker: 'spk0' },
      { startMs: 4500, endMs: 6500, speaker: 'spk1' }
    ]
    ctx.embedder.byCluster.set('spk0', voice(0))
    ctx.embedder.byCluster.set('spk1', voice(90))
    return ctx
  }

  const register = (ctx: Awaited<ReturnType<typeof build>>, name: string, degrees: number): void => {
    ctx.voiceprints.entries.push({
      name,
      vector: voice(degrees),
      sources: [{ key: `seed:${name}`, vector: voice(degrees) }],
      modelKey: ctx.embedder.modelKey,
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
  }

  it('声紋帳と一致した話者には登録済みの名前を付ける', async () => {
    const ctx = await withVoices()
    register(ctx, '田中さん', 2)

    await ctx.process.execute({ recordingId: 'rec-1' })

    expect((await ctx.artifacts.readTranscript(ctx.recording))?.speakers).toEqual([
      { id: SELF_SPEAKER_ID, kind: 'self', label: '自分' },
      { id: 'remote:spk0', kind: 'remote', label: '田中さん' },
      { id: 'remote:spk1', kind: 'remote', label: '参加者B' }
    ])
  })

  it('一致しなかった話者は従来どおり参加者ラベルにする', async () => {
    const ctx = await withVoices()
    // 2 人のどちらからも遠い声。0 度と 90 度の両方に対して閾値に届かない。
    register(ctx, '田中さん', 200)

    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(
      (await ctx.artifacts.readTranscript(ctx.recording))?.speakers.map((s) => s.label)
    ).toEqual(['自分', '参加者A', '参加者B'])
  })

  it('利用者が付けた名前は声紋の一致より優先する', async () => {
    const ctx = await withVoices()
    await ctx.process.execute({ recordingId: 'rec-1' })

    const saved = await ctx.artifacts.readTranscript(ctx.recording)
    await ctx.artifacts.writeTranscript(ctx.recording, {
      segments: saved?.segments ?? [],
      speakers: (saved?.speakers ?? []).map((speaker) =>
        speaker.id === 'remote:spk0' ? { ...speaker, label: '佐藤さん' } : speaker
      )
    })
    register(ctx, '田中さん', 2)

    // 中間 WAV が残っている（どこかのステップが失敗した）状況での再実行。
    await ctx.artifacts.writeTracks(ctx.recording, tracks)
    await ctx.process.execute({ recordingId: 'rec-1', only: ['diarize'] })

    expect((await ctx.artifacts.readTranscript(ctx.recording))?.speakers[1]?.label).toBe('佐藤さん')
  })

  it('再実行では、既定ラベルのままの話者にだけ声紋の名前を入れる', async () => {
    const ctx = await withVoices()
    await ctx.process.execute({ recordingId: 'rec-1' })

    // 1 人目は利用者が名前を付け、2 人目は「参加者B」のまま。
    const saved = await ctx.artifacts.readTranscript(ctx.recording)
    await ctx.artifacts.writeTranscript(ctx.recording, {
      segments: saved?.segments ?? [],
      speakers: (saved?.speakers ?? []).map((speaker) =>
        speaker.id === 'remote:spk0' ? { ...speaker, label: '佐藤さん' } : speaker
      )
    })
    register(ctx, '田中さん', 2)
    register(ctx, '鈴木さん', 88)

    // 中間 WAV が残っている（どこかのステップが失敗した）状況での再実行。
    await ctx.artifacts.writeTracks(ctx.recording, tracks)
    await ctx.process.execute({ recordingId: 'rec-1', only: ['diarize'] })

    expect(
      (await ctx.artifacts.readTranscript(ctx.recording))?.speakers.map((s) => s.label)
    ).toEqual(['自分', '佐藤さん', '鈴木さん'])
  })

  it('話者ごとの声紋を録音に残す（後のリネームで声紋帳に登録するため）', async () => {
    const ctx = await withVoices()

    await ctx.process.execute({ recordingId: 'rec-1' })

    const voices = await ctx.artifacts.readVoices(ctx.recording)
    expect(voices?.modelKey).toBe(ctx.embedder.modelKey)
    expect(voices?.speakers.map((s) => s.speakerId)).toEqual(['remote:spk0', 'remote:spk1'])
  })

  it('話者識別が無効なら声紋を取りに行かない', async () => {
    const ctx = await withVoices({ diarization: { enabled: false } })

    await ctx.process.execute({ recordingId: 'rec-1' })

    expect(ctx.embedder.calls).toEqual([])
  })

  it('抽出に失敗したら前回の声紋を残さない（別人に名前が付くのを防ぐ）', async () => {
    const ctx = await withVoices()
    await ctx.process.execute({ recordingId: 'rec-1' })
    expect((await ctx.artifacts.readVoices(ctx.recording))?.speakers).toHaveLength(2)

    // クラスタ番号は実行のたびに振り直される。古い声紋が残ると、次に名前を
    // 付けたときに別人のベクトルをその名前で覚えてしまう。
    ctx.embedder.error = new Error('モデルを読めません')
    // 中間 WAV が残っている（どこかのステップが失敗した）状況での再実行。
    await ctx.artifacts.writeTracks(ctx.recording, tracks)
    await ctx.process.execute({ recordingId: 'rec-1', only: ['diarize'] })

    expect((await ctx.artifacts.readVoices(ctx.recording))?.speakers).toEqual([])
  })

  it('声紋の抽出に失敗しても話者識別そのものは通す', async () => {
    const ctx = await withVoices()
    ctx.embedder.error = new Error('モデルを読めません')

    const result = await ctx.process.execute({ recordingId: 'rec-1' })

    expect(result.steps.diarize.status).toBe('done')
    expect(
      (await ctx.artifacts.readTranscript(ctx.recording))?.speakers.map((s) => s.label)
    ).toEqual(['自分', '参加者A', '参加者B'])
  })
})
