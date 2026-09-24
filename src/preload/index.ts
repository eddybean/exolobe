import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PipelineStep } from '@domain/Recording'
import type { Settings, SettingsPatch } from '@domain/Settings'
import type { Speaker } from '@domain/Speaker'
import type { TranscriptSegment } from '@domain/TranscriptSegment'
import {
  IPC,
  type FolderDto,
  type ImportAudioResultDto,
  type ImportProgressDto,
  type ManagedAssetStatusDto,
  type ModelProgressDto,
  type VoiceLearnedDto,
  type ProgressEventDto,
  type RecordingDetailDto,
  type RecordingDto,
  type ChatAvailabilityDto,
  type ChatChunkDto,
  type ChatDoneDto,
  type RendererApi,
  type SearchHitDto,
  type TranscriptHitDto,
  type SearchIndexStatusDto,
  type VoiceprintDto,
  type SearchSyncStateDto,
  type SetupStateDto,
  type SilenceAlertDto,
  type StartAlertDto,
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
  getSystemAudioLevel: () => ipcRenderer.invoke(IPC.getSystemAudioLevel) as Promise<number>,
  dismissSilenceAlert: () => ipcRenderer.invoke(IPC.dismissSilenceAlert) as Promise<void>,
  dismissStartAlert: () => ipcRenderer.invoke(IPC.dismissStartAlert) as Promise<void>,
  retryStep: (recordingId, step: PipelineStep) =>
    ipcRenderer.invoke(IPC.retryStep, recordingId, step) as Promise<RecordingDto>,
  importAudioFiles: (filePaths) =>
    ipcRenderer.invoke(IPC.importAudioFiles, filePaths) as Promise<ImportAudioResultDto>,
  chooseAudioFilesToImport: () =>
    ipcRenderer.invoke(IPC.chooseAudioFilesToImport) as Promise<ImportAudioResultDto>,
  /*
   * File.path は Electron 32 で無くなったので、webUtils で実パスを引く。
   * レンダラーは Node に触れないため、この変換は preload にしか置けない。
   */
  pathForFile: (file) => webUtils.getPathForFile(file),

  updateNote: (recordingId, note) =>
    ipcRenderer.invoke(IPC.updateNote, recordingId, note) as Promise<void>,
  renameRecording: (recordingId, title) =>
    ipcRenderer.invoke(IPC.renameRecording, recordingId, title) as Promise<RecordingDto>,
  renameSpeaker: (recordingId, speakerId, label) =>
    ipcRenderer.invoke(IPC.renameSpeaker, recordingId, speakerId, label) as Promise<Speaker[]>,
  editSegmentText: (recordingId, segment, text) =>
    ipcRenderer.invoke(IPC.editSegmentText, recordingId, segment, text) as Promise<
      TranscriptSegment[]
    >,
  deleteRecording: (recordingId) =>
    ipcRenderer.invoke(IPC.deleteRecording, recordingId) as Promise<void>,
  confirmDeleteRecording: (recordingId) =>
    ipcRenderer.invoke(IPC.confirmDeleteRecording, recordingId) as Promise<boolean>,
  revealRecording: (recordingId) =>
    ipcRenderer.invoke(IPC.revealRecording, recordingId) as Promise<void>,

  listFolders: () => ipcRenderer.invoke(IPC.listFolders) as Promise<FolderDto[]>,
  createFolder: (params) => ipcRenderer.invoke(IPC.createFolder, params) as Promise<FolderDto>,
  renameFolder: (folderId, name) =>
    ipcRenderer.invoke(IPC.renameFolder, folderId, name) as Promise<FolderDto>,
  moveFolder: (folderId, parentId) =>
    ipcRenderer.invoke(IPC.moveFolder, folderId, parentId) as Promise<void>,
  deleteFolder: (folderId) => ipcRenderer.invoke(IPC.deleteFolder, folderId) as Promise<void>,
  moveRecordingToFolder: (recordingId, folderId) =>
    ipcRenderer.invoke(IPC.moveRecordingToFolder, recordingId, folderId) as Promise<RecordingDto>,

  getSetupState: () => ipcRenderer.invoke(IPC.getSetupState) as Promise<SetupStateDto>,
  getModelStatus: () =>
    ipcRenderer.invoke(IPC.getModelStatus) as Promise<ManagedAssetStatusDto[]>,
  downloadModel: (id) => ipcRenderer.invoke(IPC.downloadModel, id) as Promise<Settings>,
  cancelModelDownload: (id) =>
    ipcRenderer.invoke(IPC.cancelModelDownload, id) as Promise<void>,
  deleteModel: (id) => ipcRenderer.invoke(IPC.deleteModel, id) as Promise<Settings>,
  confirmDeleteModel: (id) =>
    ipcRenderer.invoke(IPC.confirmDeleteModel, id) as Promise<boolean>,
  updateSettings: (patch: SettingsPatch) =>
    ipcRenderer.invoke(IPC.updateSettings, patch) as Promise<Settings>,
  chooseStorageDir: () =>
    ipcRenderer.invoke(IPC.chooseStorageDir) as Promise<string | undefined>,
  chooseFile: (kind) => ipcRenderer.invoke(IPC.chooseFile, kind) as Promise<string | undefined>,

  pushMicPcm: (pcm) => ipcRenderer.send(IPC.pushMicPcm, pcm),

  onProgress: (listener) => subscribe<ProgressEventDto>(IPC.progress, listener),
  onRecordingsChanged: (listener) => subscribe(IPC.recordingsChanged, () => listener()),
  onFoldersChanged: (listener) => subscribe(IPC.foldersChanged, () => listener()),
  onTransportChanged: (listener) => subscribe<TransportStateDto>(IPC.transportChanged, listener),
  onSilenceAlert: (listener) => subscribe<SilenceAlertDto>(IPC.silenceAlert, listener),
  onStartAlert: (listener) => subscribe<StartAlertDto>(IPC.startAlert, listener),
  onModelProgress: (listener) => subscribe<ModelProgressDto>(IPC.modelProgress, listener),
  onVoiceLearned: (listener) => subscribe<VoiceLearnedDto>(IPC.voiceLearned, listener),
  onImportProgress: (listener) => subscribe<ImportProgressDto>(IPC.importProgress, listener),

  searchRecordings: (query) =>
    ipcRenderer.invoke(IPC.searchRecordings, query) as Promise<SearchHitDto[]>,
  searchTranscripts: (query) =>
    ipcRenderer.invoke(IPC.searchTranscripts, query) as Promise<TranscriptHitDto[]>,
  getSearchIndexStatus: () =>
    ipcRenderer.invoke(IPC.getSearchIndexStatus) as Promise<SearchIndexStatusDto>,
  confirmClearSearchIndex: () =>
    ipcRenderer.invoke(IPC.confirmClearSearchIndex) as Promise<boolean>,
  clearSearchIndex: () =>
    ipcRenderer.invoke(IPC.clearSearchIndex) as Promise<SearchIndexStatusDto>,
  onSearchIndexChanged: (listener) =>
    subscribe<SearchSyncStateDto>(IPC.searchIndexChanged, listener),

  askChat: (params) => ipcRenderer.invoke(IPC.askChat, params) as Promise<void>,
  cancelChat: (requestId) => ipcRenderer.invoke(IPC.cancelChat, requestId) as Promise<void>,
  getChatAvailability: () =>
    ipcRenderer.invoke(IPC.getChatAvailability) as Promise<ChatAvailabilityDto>,
  onChatChunk: (listener) => subscribe<ChatChunkDto>(IPC.chatChunk, listener),
  onChatDone: (listener) => subscribe<ChatDoneDto>(IPC.chatDone, listener),
  listVoiceprints: () => ipcRenderer.invoke(IPC.listVoiceprints) as Promise<VoiceprintDto[]>,
  confirmRemoveVoiceprint: (name) =>
    ipcRenderer.invoke(IPC.confirmRemoveVoiceprint, name) as Promise<boolean>,
  removeVoiceprint: (name) =>
    ipcRenderer.invoke(IPC.removeVoiceprint, name) as Promise<VoiceprintDto[]>,
  confirmClearVoiceprints: () =>
    ipcRenderer.invoke(IPC.confirmClearVoiceprints) as Promise<boolean>,
  clearVoiceprints: () => ipcRenderer.invoke(IPC.clearVoiceprints) as Promise<VoiceprintDto[]>
}

contextBridge.exposeInMainWorld('recorder', api)
