import { BrowserWindow, dialog, ipcMain, shell, type FileFilter } from 'electron'
import type { PipelineStep } from '@domain/Recording'
import { toMessage } from '@domain/errors'
import type { SettingsPatch } from '@domain/Settings'
import {
  IPC,
  toRecordingDto,
  type ModelProgressDto,
  type ProgressEventDto,
  type RecordingDetailDto,
  type RecordingDto,
  type TransportStateDto
} from '@shared/ipc'
import type { Container } from '../container'
import { PipelineClient } from '../worker/PipelineClient'

/** トレイからも呼べるよう、録音の開始・停止を切り出したもの。 */
export interface TransportController {
  start(title?: string): Promise<RecordingDto>
  stop(): Promise<RecordingDto>
  state(): TransportStateDto
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
  let active: { recordingId: string; title: string; startedAtMs: number } | undefined

  const send = (channel: string, payload?: unknown): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
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

  const notifyTransport = (): void => send(IPC.transportChanged, transportState())

  // 重い推論は別プロセスで動かす。ネイティブライブラリが落ちても UI は生き残る。
  const pipeline = new PipelineClient((event: ProgressEventDto) => {
    send(IPC.progress, event)
    send(IPC.recordingsChanged)
  })

  /**
   * 停止後の処理。UI を待たせないため待たずに走らせ、進捗は IPC で伝える。
   * 個々のステップの失敗は ProcessRecording が録音の状態として記録するので、
   * ここで拾うのはワーカーごと落ちたような想定外の場合だけ。
   */
  const runPipeline = (recordingId: string): void => {
    pipeline
      .run({ recordingId })
      .catch((error: unknown) => {
        send(IPC.progress, {
          recordingId,
          step: 'mix',
          status: 'failed',
          error: toMessage(error)
        } satisfies ProgressEventDto)
      })
      .finally(() => send(IPC.recordingsChanged))
  }

  const controller: TransportController = {
    async start(title?: string): Promise<RecordingDto> {
      const params = title === undefined ? {} : { title }
      const recording = await container.startRecording.execute(params)

      active = {
        recordingId: recording.id,
        title: recording.title,
        startedAtMs: Date.now()
      }
      notifyTransport()
      send(IPC.recordingsChanged)

      return toRecordingDto(recording)
    },

    async stop(): Promise<RecordingDto> {
      const activeId = active?.recordingId
      if (!activeId) throw new Error('録音中ではありません。')

      const { recording } = await container.stopRecording.execute(activeId)
      active = undefined
      notifyTransport()
      send(IPC.recordingsChanged)

      runPipeline(recording.id)
      return toRecordingDto(recording)
    },

    state: transportState
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

  handle(IPC.retryStep, async (id: unknown, step: unknown): Promise<RecordingDto> => {
    const recording = await pipeline.run({
      recordingId: asString(id, '録音 ID'),
      only: [asStep(step)]
    })
    send(IPC.recordingsChanged)
    return recording
  })

  handle(IPC.updateNote, async (id: unknown, note: unknown): Promise<void> => {
    await container.updateNote.execute({
      recordingId: asString(id, '録音 ID'),
      note: typeof note === 'string' ? note : ''
    })
  })

  handle(IPC.renameRecording, async (id: unknown, title: unknown): Promise<RecordingDto> => {
    const recording = await container.renameRecording.execute({
      recordingId: asString(id, '録音 ID'),
      title: asString(title, 'タイトル')
    })
    send(IPC.recordingsChanged)
    return toRecordingDto(recording)
  })

  handle(IPC.renameSpeaker, async (id: unknown, speakerId: unknown, label: unknown) =>
    container.renameSpeaker.execute({
      recordingId: asString(id, '録音 ID'),
      speakerId: asString(speakerId, '話者 ID'),
      label: asString(label, '話者名')
    })
  )

  /**
   * 削除は取り消せず、音声・文字起こし・要約・メモがまとめて消える。
   * renderer 側の confirm はブロッキングで見た目も浮くため、OS のダイアログで確認する。
   */
  handle(IPC.confirmDeleteRecording, async (id: unknown): Promise<boolean> => {
    const detail = await container.getRecordingDetail.execute(asString(id, '録音 ID'))
    const window = getWindow()

    const options = {
      type: 'warning' as const,
      buttons: ['削除', 'キャンセル'],
      defaultId: 1,
      cancelId: 1,
      message: `「${detail.recording.title}」を削除しますか？`,
      detail: '音声・文字起こし・要約・メモがすべて削除されます。この操作は取り消せません。'
    }

    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)

    return result.response === 0
  })

  handle(IPC.deleteRecording, async (id: unknown): Promise<void> => {
    await container.deleteRecording.execute(asString(id, '録音 ID'))
    send(IPC.recordingsChanged)
  })

  handle(IPC.revealRecording, async (id: unknown): Promise<void> => {
    const detail = await container.getRecordingDetail.execute(asString(id, '録音 ID'))
    shell.showItemInFolder(detail.audioPath)
  })

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

  handle(IPC.updateSettings, async (patch: unknown) => {
    const settings = await container.updateSettings.execute(patch as SettingsPatch)
    send(IPC.recordingsChanged)
    return settings
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

  return controller
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

const asFileKind = (value: unknown): keyof typeof FILE_FILTERS => {
  if (value === 'whisper-model' || value === 'llm-model' || value === 'onnx-model') return value
  throw new Error('選択するファイルの種類が不正です。')
}
