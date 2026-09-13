import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell, type FileFilter } from 'electron'
import type { PipelineStep } from '@domain/Recording'
import { ConfigurationError, toMessage } from '@domain/errors'
import { IMPORTABLE_EXTENSIONS } from '@domain/AudioImport'
import { findAsset, formatBytes } from '@domain/ModelCatalog'
import { DEFAULT_SEARCH_LIMIT, searchIndexTransition } from '@domain/SemanticSearch'
import type { Settings, SettingsPatch } from '@domain/Settings'
import { DEFAULT_QUIET_RATIO, DEFAULT_SILENCE_LEVEL } from '@domain/SilenceWatch'
import { DEFAULT_BUSY_RATIO } from '@domain/StartWatch'
import {
  IPC,
  toFolderDto,
  toRecordingDto,
  type FolderDto,
  type ImportAudioResultDto,
  type ImportFailureDto,
  type ImportProgressDto,
  type ModelProgressDto,
  type ProgressEventDto,
  type RecordingDetailDto,
  type RecordingDto,
  type SearchHitDto,
  type SearchIndexStatusDto,
  type VoiceprintDto,
  type SilenceAlertDto,
  type StartAlertDto,
  type TransportStateDto
} from '@shared/ipc'
import type { Container } from '../container'
import { createSearchSyncScheduler } from '../searchSyncScheduler'
import { createSilenceMonitor } from '../silenceMonitor'
import { notifySilence } from '../silenceNotification'
import { createStartMonitor } from '../startMonitor'
import { notifyMeetingStart } from '../startNotification'
import { PipelineClient } from '../worker/PipelineClient'
import { SearchClient } from '../worker/SearchClient'

/** 無音を判定する間隔。会議の沈黙は分単位なので、1 秒ごとで十分細かい。 */
const SILENCE_SAMPLE_INTERVAL_MS = 1_000

/**
 * マイクの使用を判定する間隔。
 *
 * 無音の見張りと違って標本は子プロセスから届く真偽値なので、細かく刻む意味がない。
 * 既定の 1 分半に対して十分な標本数（18）が取れる 5 秒にする。
 */
const START_SAMPLE_INTERVAL_MS = 5_000

/** トレイからも呼べるよう、録音の開始・停止を切り出したもの。 */
export interface TransportController {
  start(title?: string): Promise<RecordingDto>
  stop(): Promise<RecordingDto>
  state(): TransportStateDto
  /** 録音状態の変化を購読する。メニューやトレイの表示を追従させるために使う。 */
  onStateChanged(listener: () => void): void
}

/**
 * IPC ハンドラを登録し、トレイからも使える操作を返す。
 *
 * renderer から届く値は信頼できないため、各ハンドラの入口で型を絞ってから
 * ユースケースへ渡す。例外は利用者向けメッセージへ変換して返す。
 */
export const registerIpcHandlers = (
  container: Container,
  getWindow: () => BrowserWindow | undefined
): TransportController => {
  let active:
    | { recordingId: string; title: string; startedAtMs: number; silenceDurationMs: number }
    | undefined

  const send = (channel: string, payload?: unknown): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }

  /**
   * 取り消せない操作を OS のダイアログで確認する。
   *
   * renderer 側の confirm はブロッキングで見た目も浮くため使わない。
   * ウィンドウが無い（トレイからの操作）場合もあるので、その時は親無しで出す。
   */
  const confirm = async (params: {
    message: string
    detail: string
    confirmLabel?: string
  }): Promise<boolean> => {
    const window = getWindow()
    const options = {
      type: 'warning' as const,
      buttons: [params.confirmLabel ?? '削除', 'キャンセル'],
      defaultId: 1,
      cancelId: 1,
      message: params.message,
      detail: params.detail
    }

    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)

    return result.response === 0
  }

  const transportState = (): TransportStateDto =>
    active
      ? {
          active: true,
          recordingId: active.recordingId,
          title: active.title,
          startedAtMs: active.startedAtMs
        }
      : { active: false }

  // renderer 以外（メニュー・トレイ）にも状態変化を伝える。
  const stateListeners: (() => void)[] = []

  const notifyTransport = (): void => {
    send(IPC.transportChanged, transportState())
    for (const listener of stateListeners) listener()
  }

  // 重い推論は別プロセスで動かす。ネイティブライブラリが落ちても UI は生き残る。
  const pipeline = new PipelineClient((event: ProgressEventDto) => {
    send(IPC.progress, event)
    send(IPC.recordingsChanged)
  })

  /**
   * 意味検索。埋め込みモデルは検索専用のワーカーに載せる。
   *
   * 索引の同期は録音中とその後処理の間は走らせない。要約の LLM と同時に載ると
   * メモリが足りなくなり、会議アプリの音声まで途切れかねないため。
   */
  const search = new SearchClient()
  const searchSync = createSearchSyncScheduler({
    isEnabled: async () => (await container.settings.load()).search.enabled,
    isBusy: () => pipeline.isBusy() || active !== undefined,
    run: async (onProgress) => {
      await search.sync(onProgress)
    },
    onStateChange: (state) => send(IPC.searchIndexChanged, state)
  })

  /** 重い処理に入る前に、同期を止めて埋め込みモデルの分のメモリを空ける。 */
  const yieldSearch = (): void => {
    search.cancelSync()
    search.releaseWhenIdle()
  }

  pipeline.onBusyChange((busy) => {
    if (busy) yieldSearch()
    // 処理が片付けば文字起こしと要約が揃っているので、索引に入れる好機でもある。
    else searchSync.request()
  })

  const searchStatus = async (): Promise<SearchIndexStatusDto> => ({
    ...(await container.getSearchIndexStatus.execute()),
    sync: searchSync.state()
  })

  /**
   * 録りっぱなしの見張り。録音中だけ動かし、無音が続いたら知らせる。
   * 勝手に止めはしない（会議が静かなだけかもしれない）。
   */
  let silenceTimer: NodeJS.Timeout | undefined

  const silence = createSilenceMonitor({
    onPeak: (listener) => container.recorder.onPeak(listener),
    onSilence: () => {
      const current = active
      if (!current) return

      const alert: SilenceAlertDto = {
        recordingId: current.recordingId,
        silentDurationMs: current.silenceDurationMs
      }
      send(IPC.silenceAlert, alert)

      notifySilence({
        minutes: Math.round(current.silenceDurationMs / 60_000),
        onStop: () => {
          controller.stop().catch((error: unknown) => console.error(toMessage(error)))
        },
        onShowWindow: focusWindow
      })
    }
  })

  const focusWindow = (): void => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  const startSilenceWatch = async (): Promise<number> => {
    const { recording } = await container.settings.load()
    silence.start(
      recording.silenceAlertEnabled
        ? {
            level: DEFAULT_SILENCE_LEVEL,
            durationMs: recording.silenceDurationMs,
            quietRatio: DEFAULT_QUIET_RATIO
          }
        : undefined
    )
    silenceTimer = setInterval(() => silence.tick(Date.now()), SILENCE_SAMPLE_INTERVAL_MS)
    return recording.silenceDurationMs
  }

  const stopSilenceWatch = (): void => {
    if (silenceTimer) clearInterval(silenceTimer)
    silenceTimer = undefined
    silence.stop()
  }

  /**
   * 開始忘れの見張り。録音していない間だけ動かす。
   * 録音中は自分自身がマイクを使うため、見張っても意味がない。
   */
  let startTimer: NodeJS.Timeout | undefined
  let startAlertDelayMs = 0

  const startWatch = createStartMonitor({
    onChange: (listener) => container.micUsage.onChange(listener),
    onMeetingStarted: () => {
      // 促している間に録音が始まっていたら、もう用は無い。
      if (active) return

      send(IPC.startAlert, { micBusyDurationMs: startAlertDelayMs } satisfies StartAlertDto)

      notifyMeetingStart({
        minutes: Math.round(startAlertDelayMs / 60_000),
        onStart: () => {
          controller.start().catch((error: unknown) => console.error(toMessage(error)))
        },
        onShowWindow: focusWindow
      })
    }
  })

  const startStartWatch = async (): Promise<void> => {
    const { recording } = await container.settings.load()
    const enabled = recording.startAlertEnabled && container.micUsage.available
    startAlertDelayMs = recording.startAlertDelayMs

    if (!enabled) {
      stopStartWatch()
      return
    }

    container.micUsage.start()
    startWatch.start({ durationMs: recording.startAlertDelayMs, busyRatio: DEFAULT_BUSY_RATIO })
    startTimer ??= setInterval(() => startWatch.tick(Date.now()), START_SAMPLE_INTERVAL_MS)
  }

  const stopStartWatch = (): void => {
    if (startTimer) clearInterval(startTimer)
    startTimer = undefined
    startWatch.stop()
    container.micUsage.stop()
  }

  /**
   * 停止後の処理。UI を待たせないため待たずに走らせ、進捗は IPC で伝える。
   * 個々のステップの失敗は ProcessRecording が録音の状態として記録するので、
   * ここで拾うのはワーカーごと落ちたような想定外の場合だけ。
   */
  const runPipeline = async (recordingId: string): Promise<void> => {
    try {
      await pipeline.run({ recordingId })
    } catch (error: unknown) {
      send(IPC.progress, {
        recordingId,
        step: 'mix',
        status: 'failed',
        error: toMessage(error)
      } satisfies ProgressEventDto)
    } finally {
      send(IPC.recordingsChanged)
    }
  }

  /**
   * 後処理は 1 件ずつ投げる。
   *
   * PipelineClient は抱えている依頼が残っている間ワーカーを終了させないため、run を
   * 続けて呼ぶと 1 プロセスで複数のジョブを捌く。話者識別と要約のネイティブが確保した
   * メモリが次のジョブへ持ち越され、ADR-008 が 1 プロセス 1 ジョブにした理由そのものに
   * 戻ってしまう。複数ファイルの取り込みでも録音停止の直後でも、ここを通して直列にする。
   */
  let pipelineQueue: Promise<void> = Promise.resolve()

  const enqueuePipeline = (recordingId: string): void => {
    pipelineQueue = pipelineQueue.then(() => runPipeline(recordingId))
  }

  const controller: TransportController = {
    async start(title?: string): Promise<RecordingDto> {
      // 録音を始めたら促す必要はない。子プロセスも止めて無駄に動かさない。
      stopStartWatch()

      const params = title === undefined ? {} : { title }
      let recording
      try {
        recording = await container.startRecording.execute(params)
      } catch (error: unknown) {
        // 開始に失敗したなら録音していない状態のままなので、見張りを戻す。
        void startStartWatch()
        throw error
      }

      active = {
        recordingId: recording.id,
        title: recording.title,
        startedAtMs: Date.now(),
        silenceDurationMs: await startSilenceWatch()
      }
      yieldSearch()
      notifyTransport()
      send(IPC.recordingsChanged)

      return toRecordingDto(recording)
    },

    async stop(): Promise<RecordingDto> {
      const activeId = active?.recordingId
      if (!activeId) throw new Error('録音中ではありません。')

      stopSilenceWatch()
      const { recording } = await container.stopRecording.execute(activeId)
      active = undefined
      notifyTransport()
      send(IPC.recordingsChanged)

      enqueuePipeline(recording.id)
      void startStartWatch()

      return toRecordingDto(recording)
    },

    state: transportState,
    onStateChanged: (listener) => {
      stateListeners.push(listener)
    }
  }

  handle(IPC.listRecordings, async (): Promise<RecordingDto[]> => {
    const recordings = await container.listRecordings.execute()
    return recordings.map((recording) => toRecordingDto(recording, recording.summaryPreview))
  })

  handle(IPC.getRecording, async (id: unknown): Promise<RecordingDetailDto> => {
    const detail = await container.getRecordingDetail.execute(asString(id, '録音 ID'))

    return {
      recording: toRecordingDto(detail.recording),
      audioPath: detail.audioPath,
      segments: detail.segments,
      speakers: detail.speakers,
      transcriptText: detail.transcriptMarkdown,
      ...(detail.summary === undefined ? {} : { summary: detail.summary }),
      note: detail.note
    }
  })

  handle(IPC.startRecording, async (title: unknown) =>
    controller.start(typeof title === 'string' && title.trim() ? title : undefined)
  )
  handle(IPC.stopRecording, async () => controller.stop())
  handle(IPC.getTransportState, async () => transportState())
  handle(IPC.getSystemAudioLevel, async () => container.recorder.systemLevel())
  handle(IPC.dismissSilenceAlert, async () => silence.dismiss(Date.now()))

  handle(IPC.dismissStartAlert, async () => startWatch.dismiss())

  handle(IPC.retryStep, async (id: unknown, step: unknown): Promise<RecordingDto> => {
    const recording = await pipeline.run({
      recordingId: asString(id, '録音 ID'),
      only: [asStep(step)]
    })
    send(IPC.recordingsChanged)
    return recording
  })

  /**
   * 手元の音声ファイルを順に取り込む。
   *
   * 1 件ずつにするのは、afconvert を何本も同時に動かしてもディスクとコアを取り合う
   * だけで速くならないため。変換が済んだ録音はその都度一覧へ出し、残りの変換を
   * 待たせない。1 件の失敗で他のファイルを諦めることはせず、理由を集めて返す。
   */
  const importAudioFiles = async (paths: readonly string[]): Promise<ImportAudioResultDto> => {
    const imported: RecordingDto[] = []
    const failed: ImportFailureDto[] = []

    for (const [index, filePath] of paths.entries()) {
      send(IPC.importProgress, {
        done: index,
        total: paths.length,
        fileName: basename(filePath)
      } satisfies ImportProgressDto)

      try {
        const recording = await container.importAudioFile.execute({ filePath })
        imported.push(toRecordingDto(recording))
        send(IPC.recordingsChanged)
        enqueuePipeline(recording.id)
      } catch (error: unknown) {
        failed.push({ fileName: basename(filePath), reason: toMessage(error) })
      }
    }

    // 終わりの合図は invoke の解決に任せる。ここで最後の進捗を送ると、それが
    // 解決より後に届いて「取り込み中」の表示が消えなくなる。
    return { imported, failed }
  }

  handle(IPC.importAudioFiles, async (paths: unknown) => importAudioFiles(asFilePaths(paths)))

  handle(IPC.chooseAudioFilesToImport, async (): Promise<ImportAudioResultDto> => {
    const result = await dialog.showOpenDialog({
      title: '取り込む音声ファイルを選択',
      properties: ['openFile', 'multiSelections'],
      buttonLabel: '取り込む',
      filters: AUDIO_IMPORT_FILTERS
    })
    if (result.canceled || result.filePaths.length === 0) return { imported: [], failed: [] }

    return importAudioFiles(result.filePaths)
  })

  handle(IPC.updateNote, async (id: unknown, note: unknown): Promise<void> => {
    await container.updateNote.execute({
      recordingId: asString(id, '録音 ID'),
      note: typeof note === 'string' ? note : ''
    })
    searchSync.request()
  })

  handle(IPC.renameRecording, async (id: unknown, title: unknown): Promise<RecordingDto> => {
    const recording = await container.renameRecording.execute({
      recordingId: asString(id, '録音 ID'),
      title: asString(title, 'タイトル')
    })
    send(IPC.recordingsChanged)
    return toRecordingDto(recording)
  })

  handle(IPC.renameSpeaker, async (id: unknown, speakerId: unknown, label: unknown) => {
    const speakers = await container.renameSpeaker.execute({
      recordingId: asString(id, '録音 ID'),
      speakerId: asString(speakerId, '話者 ID'),
      label: asString(label, '話者名')
    })
    // 索引の文字起こしチャンクは「話者名: 発言」なので、名前が変われば作り直す。
    searchSync.request()
    return speakers
  })

  /**
   * 削除は取り消せず、音声・文字起こし・要約・メモがまとめて消える。
   * renderer 側の confirm はブロッキングで見た目も浮くため、OS のダイアログで確認する。
   */
  handle(IPC.confirmDeleteRecording, async (id: unknown): Promise<boolean> => {
    const detail = await container.getRecordingDetail.execute(asString(id, '録音 ID'))

    return confirm({
      message: `「${detail.recording.title}」を削除しますか？`,
      detail: '音声・文字起こし・要約・メモがすべて削除されます。この操作は取り消せません。'
    })
  })

  handle(IPC.deleteRecording, async (id: unknown): Promise<void> => {
    await container.deleteRecording.execute(asString(id, '録音 ID'))
    send(IPC.recordingsChanged)
    // 本文を消したのに、そのベクトルが残り続けないようにする。
    searchSync.request()
  })

  handle(IPC.revealRecording, async (id: unknown): Promise<void> => {
    const detail = await container.getRecordingDetail.execute(asString(id, '録音 ID'))
    shell.showItemInFolder(detail.audioPath)
  })

  handle(IPC.listFolders, async (): Promise<FolderDto[]> => {
    const folders = await container.listFolders.execute()
    return folders.map(toFolderDto)
  })

  handle(IPC.createFolder, async (params: unknown): Promise<FolderDto> => {
    const { name, parentId } = asFolderCreateParams(params)
    const folder = await container.createFolder.execute({ name, parentId })
    send(IPC.foldersChanged)
    return toFolderDto(folder)
  })

  handle(IPC.renameFolder, async (id: unknown, name: unknown): Promise<FolderDto> => {
    const folder = await container.renameFolder.execute({
      folderId: asString(id, 'フォルダ ID'),
      name: asString(name, 'フォルダ名')
    })
    send(IPC.foldersChanged)
    return toFolderDto(folder)
  })

  handle(IPC.moveFolder, async (id: unknown, parentId: unknown): Promise<void> => {
    await container.moveFolder.execute({
      folderId: asString(id, 'フォルダ ID'),
      parentId: typeof parentId === 'string' ? parentId : undefined
    })
    send(IPC.foldersChanged)
  })

  handle(IPC.deleteFolder, async (id: unknown): Promise<void> => {
    await container.deleteFolder.execute({ folderId: asString(id, 'フォルダ ID') })
    send(IPC.foldersChanged)
    send(IPC.recordingsChanged)
  })

  handle(
    IPC.moveRecordingToFolder,
    async (id: unknown, folderId: unknown): Promise<RecordingDto> => {
      const recording = await container.moveRecordingToFolder.execute({
        recordingId: asString(id, '録音 ID'),
        folderId: typeof folderId === 'string' ? folderId : undefined
      })
      send(IPC.recordingsChanged)
      return toRecordingDto(recording)
    }
  )

  handle(IPC.getSetupState, async () => container.getSetupState.execute())

  handle(IPC.getModelStatus, async () => container.getModelStatus.execute())

  handle(IPC.downloadModel, async (id: unknown) => {
    const modelId = asString(id, 'モデル ID')

    try {
      const settings = await container.downloadModel.execute({
        id: modelId,
        // 数 GB のダウンロードになるので、進捗を逐次 UI へ流す。
        onProgress: (receivedBytes, totalBytes) =>
          send(IPC.modelProgress, {
            id: modelId,
            receivedBytes,
            status: 'downloading',
            ...(totalBytes === undefined ? {} : { totalBytes })
          } satisfies ModelProgressDto)
      })

      send(IPC.modelProgress, {
        id: modelId,
        receivedBytes: 0,
        status: 'done'
      } satisfies ModelProgressDto)
      if (modelId === 'search-model') {
        // モデル無しで起きていたワーカーを捨て、新しいモデルで索引を作る。
        await search.shutdown()
        searchSync.request()
      }
      return settings
    } catch (error: unknown) {
      const message = toMessage(error)
      send(IPC.modelProgress, {
        id: modelId,
        receivedBytes: 0,
        status: message.includes('中止') ? 'cancelled' : 'failed',
        error: message
      } satisfies ModelProgressDto)
      throw error
    }
  })

  handle(IPC.cancelModelDownload, async (id: unknown) => {
    container.cancelModelDownload.execute(asString(id, 'モデル ID'))
  })

  /**
   * 削除自体は取り消せるが、要約モデルは 5GB あり再取得に数十分かかる。
   * 誤操作の代償が大きいので、録音削除と同じく OS のダイアログで確認する。
   */
  handle(IPC.confirmDeleteModel, async (id: unknown): Promise<boolean> => {
    const modelId = asString(id, 'モデル ID')
    const asset = findAsset(modelId)
    if (!asset) throw new ConfigurationError(`不明なモデルです: ${modelId}`)

    return confirm({
      message: `「${asset.label}」を削除しますか？`,
      detail: `もう一度使うには ${formatBytes(asset.bytes)} のダウンロードが必要になります。`
    })
  })

  handle(IPC.deleteModel, async (id: unknown) => {
    const modelId = asString(id, 'モデル ID')
    // 読み込み中のモデルファイルを消さないよう、先にワーカーを終わらせる。
    if (modelId === 'search-model') await search.shutdown()
    return container.deleteModel.execute(modelId)
  })

  handle(IPC.updateSettings, async (patch: unknown) => {
    const before = await container.settings.load()
    const settings = await container.updateSettings.execute(patch as SettingsPatch)
    // 開始忘れの見張りは録音していない間ずっと動いているので、設定の変更を
    // 次の録音まで待たずにここで反映する。
    if (!active) await startStartWatch()
    await applySearchSettings(before, settings)
    send(IPC.recordingsChanged)
    return settings
  })

  /** 意味検索の設定の変化を索引に反映する。無効にしたら使わない索引の容量を返す。 */
  const applySearchSettings = async (before: Settings, after: Settings): Promise<void> => {
    switch (searchIndexTransition(before.search, after.search)) {
      case 'clear':
        await clearSearchIndex()
        return
      case 'rebuild':
        await search.shutdown()
        searchSync.request()
        return
      case 'sync':
        searchSync.request()
        return
      case 'none':
        // 保存先が変われば録音一覧そのものが入れ替わる。
        if (after.search.enabled && before.storageDir !== after.storageDir) searchSync.request()
        return
    }
  }

  const clearSearchIndex = async (): Promise<void> => {
    // 書き手（ワーカー）を止めてから消す。同期の途中の書き込みで索引が蘇らないように。
    await search.shutdown()
    await container.clearSearchIndex.execute()
    searchSync.reset()
  }

  handle(IPC.searchRecordings, async (query: unknown): Promise<SearchHitDto[]> => {
    // 異常に長い入力でモデルの 1 回分の入力を超えないよう、ここで抑える。
    const text = asString(query, '検索する文章').slice(0, 500)
    const { search: config } = await container.settings.load()
    if (!config.enabled) {
      throw new ConfigurationError('意味検索が無効です。設定画面で有効にしてください。')
    }

    const hits = await search.search(text, DEFAULT_SEARCH_LIMIT)
    // 要約などが走っている間は、答えたらすぐにモデルの分のメモリを返す。
    if (pipeline.isBusy()) search.releaseWhenIdle()
    return hits
  })

  handle(IPC.getSearchIndexStatus, async () => searchStatus())

  /** 有効なまま消すと次の同期で作り直されるので、そのことも添えて確認する。 */
  handle(IPC.confirmClearSearchIndex, async (): Promise<boolean> => {
    const status = await searchStatus()

    return confirm({
      message: '意味検索のインデックスを削除しますか？',
      detail: [
        `${status.indexedCount} 件分、約 ${formatBytes(status.bytes)} が削除されます。`,
        '録音・文字起こし・要約・メモは削除されません。',
        status.enabled
          ? '意味検索が有効な間は、次に録音を処理したときなどに作り直されます。'
          : ''
      ]
        .filter(Boolean)
        .join('\n')
    })
  })

  handle(IPC.clearSearchIndex, async (): Promise<SearchIndexStatusDto> => {
    await clearSearchIndex()
    return searchStatus()
  })

  handle(IPC.listVoiceprints, async (): Promise<VoiceprintDto[]> => container.listVoiceprints.execute())

  /** 消しても録音と付けた名前は残る。何が起きるかを取り違えないよう明示する。 */
  handle(IPC.confirmRemoveVoiceprint, async (name: unknown): Promise<boolean> =>
    confirm({
      message: `「${asString(name, '話者名')}」の声を忘れますか？`,
      detail: [
        'この声で自動的に名前が入らなくなります。',
        '録音と、すでに付けた話者名はそのまま残ります。',
        'もう一度どこかの録音で同じ名前を付ければ、また覚えます。'
      ].join('\n'),
      confirmLabel: '忘れる'
    })
  )

  handle(IPC.removeVoiceprint, async (name: unknown): Promise<VoiceprintDto[]> =>
    container.removeVoiceprint.execute(asString(name, '話者名'))
  )

  handle(IPC.confirmClearVoiceprints, async (): Promise<boolean> => {
    const entries = await container.listVoiceprints.execute()
    return confirm({
      message: '覚えた声をすべて忘れますか？',
      detail: [
        `${entries.length} 人分の声が削除されます。`,
        '録音と、すでに付けた話者名はそのまま残ります。'
      ].join('\n'),
      confirmLabel: 'すべて忘れる'
    })
  })

  handle(IPC.clearVoiceprints, async (): Promise<VoiceprintDto[]> => {
    await container.clearVoiceprints.execute()
    return container.listVoiceprints.execute()
  })

  handle(IPC.chooseStorageDir, async (): Promise<string | undefined> => {
    const result = await dialog.showOpenDialog({
      title: '録音の保存先を選択',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'この場所に保存'
    })
    return result.canceled ? undefined : result.filePaths[0]
  })

  handle(IPC.chooseFile, async (kind: unknown): Promise<string | undefined> => {
    const result = await dialog.showOpenDialog({
      title: 'モデルファイルを選択',
      properties: ['openFile'],
      filters: FILE_FILTERS[asFileKind(kind)]
    })
    return result.canceled ? undefined : result.filePaths[0]
  })

  // マイク PCM は録音中に高頻度で届くので、返事を待たない one-way にする。
  ipcMain.on(IPC.pushMicPcm, (_event, pcm: unknown) => {
    if (pcm instanceof ArrayBuffer) {
      void container.recorder.pushMicPcm(Buffer.from(pcm))
    }
  })

  // 録音していない状態から始まるので、見張りもここから動かし始める。
  void startStartWatch()
  // 前回の起動以降に増えた・消えた録音を索引に反映する。
  searchSync.request()

  return controller
}

/** 取り込みのファイル選択で見せる拡張子。対応形式の定義は domain に 1 つだけ置く。 */
const AUDIO_IMPORT_FILTERS: FileFilter[] = [
  { name: '音声ファイル', extensions: [...IMPORTABLE_EXTENSIONS] }
]

/**
 * 一度に取り込める上限。
 * フォルダごとドロップされたときに、何百件もの変換が走り出さないための歯止め。
 */
const MAX_IMPORT_FILES = 50

const asFilePaths = (value: unknown): string[] => {
  if (!Array.isArray(value)) throw new Error('取り込むファイルが指定されていません。')

  const paths = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (paths.length === 0) throw new Error('取り込むファイルが指定されていません。')
  if (paths.length > MAX_IMPORT_FILES) {
    throw new Error(`一度に取り込めるのは ${MAX_IMPORT_FILES} 件までです。`)
  }

  return paths
}

const FILE_FILTERS: Record<'whisper-model' | 'llm-model' | 'onnx-model', FileFilter[]> = {
  'whisper-model': [{ name: 'whisper モデル', extensions: ['bin'] }],
  'llm-model': [{ name: 'GGUF モデル', extensions: ['gguf'] }],
  'onnx-model': [{ name: 'ONNX モデル', extensions: ['onnx'] }]
}

/**
 * ハンドラの共通ラッパー。例外はそのまま renderer へ投げると
 * 'Error invoking remote method' に包まれて読めなくなるため、
 * 利用者向けメッセージだけを持つ Error に詰め替える。
 */
const handle = (
  channel: string,
  handler: (...args: unknown[]) => Promise<unknown>
): void => {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await handler(...args)
    } catch (error: unknown) {
      throw new Error(toMessage(error))
    }
  })
}

const asString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label}が指定されていません。`)
  }
  return value
}

const PIPELINE_STEP_NAMES: readonly string[] = [
  'mix',
  'transcribe',
  'diarize',
  'summarize',
  'encode'
]

const asStep = (value: unknown): PipelineStep => {
  if (typeof value !== 'string' || !PIPELINE_STEP_NAMES.includes(value)) {
    throw new Error('再実行するステップの指定が不正です。')
  }
  return value as PipelineStep
}

const asFolderCreateParams = (value: unknown): { name: string; parentId?: string } => {
  if (typeof value !== 'object' || value === null || !('name' in value)) {
    throw new Error('フォルダ名が指定されていません。')
  }
  const candidate = value as { name: unknown; parentId?: unknown }
  const name = asString(candidate.name, 'フォルダ名')
  return typeof candidate.parentId === 'string' ? { name, parentId: candidate.parentId } : { name }
}

const asFileKind = (value: unknown): keyof typeof FILE_FILTERS => {
  if (value === 'whisper-model' || value === 'llm-model' || value === 'onnx-model') return value
  throw new Error('選択するファイルの種類が不正です。')
}
