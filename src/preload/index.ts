import { contextBridge, ipcRenderer } from 'electron'
import type { PipelineStep } from '@domain/Recording'
import type { Settings, SettingsPatch } from '@domain/Settings'
import type { Speaker } from '@domain/Speaker'
import {
  IPC,
  type ManagedAssetStatusDto,
  type ModelProgressDto,
  type ProgressEventDto,
  type RecordingDetailDto,
  type RecordingDto,
  type RendererApi,
  type SetupStateDto,
  type TransportStateDto
} from '@shared/ipc'

/**
 * renderer に渡す唯一の窓口。
 *
 * contextIsolation を有効にしたまま、必要な操作だけを型付きで公開する。
 * renderer は ipcRenderer にも Node の API にも触れない。
 */
const subscribe = <T>(channel: string, listener: (payload: T) => void): (() => void) => {
  const handler = (_event: unknown, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: RendererApi = {
  listRecordings: () => ipcRenderer.invoke(IPC.listRecordings) as Promise<RecordingDto[]>,
  getRecording: (id) => ipcRenderer.invoke(IPC.getRecording, id) as Promise<RecordingDetailDto>,
  startRecording: (title) =>
    ipcRenderer.invoke(IPC.startRecording, title) as Promise<RecordingDto>,
  stopRecording: () => ipcRenderer.invoke(IPC.stopRecording) as Promise<RecordingDto>,
  getTransportState: () =>
    ipcRenderer.invoke(IPC.getTransportState) as Promise<TransportStateDto>,
  retryStep: (recordingId, step: PipelineStep) =>
    ipcRenderer.invoke(IPC.retryStep, recordingId, step) as Promise<RecordingDto>,
  updateNote: (recordingId, note) =>
    ipcRenderer.invoke(IPC.updateNote, recordingId, note) as Promise<void>,
  renameRecording: (recordingId, title) =>
    ipcRenderer.invoke(IPC.renameRecording, recordingId, title) as Promise<RecordingDto>,
  renameSpeaker: (recordingId, speakerId, label) =>
    ipcRenderer.invoke(IPC.renameSpeaker, recordingId, speakerId, label) as Promise<Speaker[]>,
  deleteRecording: (recordingId) =>
    ipcRenderer.invoke(IPC.deleteRecording, recordingId) as Promise<void>,
  confirmDeleteRecording: (recordingId) =>
    ipcRenderer.invoke(IPC.confirmDeleteRecording, recordingId) as Promise<boolean>,
  revealRecording: (recordingId) =>
    ipcRenderer.invoke(IPC.revealRecording, recordingId) as Promise<void>,

  getSetupState: () => ipcRenderer.invoke(IPC.getSetupState) as Promise<SetupStateDto>,
  getModelStatus: () =>
    ipcRenderer.invoke(IPC.getModelStatus) as Promise<ManagedAssetStatusDto[]>,
  downloadModel: (id) => ipcRenderer.invoke(IPC.downloadModel, id) as Promise<Settings>,
  cancelModelDownload: (id) =>
    ipcRenderer.invoke(IPC.cancelModelDownload, id) as Promise<void>,
  updateSettings: (patch: SettingsPatch) =>
    ipcRenderer.invoke(IPC.updateSettings, patch) as Promise<Settings>,
  chooseStorageDir: () =>
    ipcRenderer.invoke(IPC.chooseStorageDir) as Promise<string | undefined>,
  chooseFile: (kind) => ipcRenderer.invoke(IPC.chooseFile, kind) as Promise<string | undefined>,

  pushMicPcm: (pcm) => ipcRenderer.send(IPC.pushMicPcm, pcm),

  onProgress: (listener) => subscribe<ProgressEventDto>(IPC.progress, listener),
  onRecordingsChanged: (listener) => subscribe(IPC.recordingsChanged, () => listener()),
  onTransportChanged: (listener) => subscribe<TransportStateDto>(IPC.transportChanged, listener),
  onModelProgress: (listener) => subscribe<ModelProgressDto>(IPC.modelProgress, listener)
}

contextBridge.exposeInMainWorld('recorder', api)
