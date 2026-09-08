import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { StartRecording } from '@application/usecases/StartRecording'
import { StopRecording } from '@application/usecases/StopRecording'
import {
  CreateFolder,
  DeleteFolder,
  ListFolders,
  MoveFolder,
  MoveRecordingToFolder,
  RenameFolder
} from '@application/usecases/folders'
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
import {
  CancelModelDownload,
  DeleteModel,
  DownloadModel,
  GetModelStatus
} from '@application/usecases/models'
import { AudioTeeSource } from '@infrastructure/audio/AudioTeeSource'
import { resolveAudioTeeBinary } from '@infrastructure/audio/resolveAudioTeeBinary'
import { DualTrackRecorder } from '@infrastructure/audio/DualTrackRecorder'
import { FileFolderRepository } from '@infrastructure/persistence/FileFolderStore'
import {
  FileRecordingArtifactStore,
  FileRecordingRepository
} from '@infrastructure/persistence/FileRecordingStore'
import { MicUsageProbe } from '@infrastructure/mic/MicUsageProbe'
import { resolveMicWatchBinary } from '@infrastructure/mic/resolveMicWatchBinary'
import { FileModelStore } from '@infrastructure/download/FileModelStore'
import {
  JsonSettingsRepository,
  SettingsStorageLocator
} from '@infrastructure/settings/JsonSettingsRepository'

/**
 * 依存を結線する唯一の場所。
 *
 * ここから内側（usecases / domain）は Electron も whisper も llama.cpp も知らない。
 * 差し替えたい実装があればこのファイルだけを変える。
 */
export interface Container {
  readonly settings: JsonSettingsRepository
  readonly recorder: DualTrackRecorder
  readonly micUsage: MicUsageProbe
  readonly startRecording: StartRecording
  readonly stopRecording: StopRecording
  readonly listRecordings: ListRecordings
  readonly getRecordingDetail: GetRecordingDetail
  readonly updateNote: UpdateNote
  readonly renameRecording: RenameRecording
  readonly renameSpeaker: RenameSpeaker
  readonly deleteRecording: DeleteRecording
  readonly listFolders: ListFolders
  readonly createFolder: CreateFolder
  readonly renameFolder: RenameFolder
  readonly moveFolder: MoveFolder
  readonly deleteFolder: DeleteFolder
  readonly moveRecordingToFolder: MoveRecordingToFolder
  readonly updateSettings: UpdateSettings
  readonly getSetupState: GetSetupState
  readonly getModelStatus: GetModelStatus
  readonly downloadModel: DownloadModel
  readonly cancelModelDownload: CancelModelDownload
  readonly deleteModel: DeleteModel
}

export const createContainer = (): Container => {
  const userData = app.getPath('userData')
  const settings = new JsonSettingsRepository(join(userData, 'settings.json'))
  const locator = new SettingsStorageLocator(settings)

  const repository = new FileRecordingRepository(locator)
  const artifacts = new FileRecordingArtifactStore(locator, join(userData, 'work'))
  const folderRepository = new FileFolderRepository(locator)
  const folderDeps = {
    folders: folderRepository,
    recordings: repository,
    ids: { next: () => randomUUID() }
  }
  // audiotee は自分の JS の位置からバイナリを探すため、パッケージ済みアプリでは
  // asar 内のパスを解決してしまい起動できない。実パスを明示的に渡す。
  const recorder = new DualTrackRecorder(
    new AudioTeeSource(
      resolveAudioTeeBinary({ packaged: app.isPackaged, resourcesPath: process.resourcesPath })
    )
  )
  // 録音していない間だけ動かす見張り。同梱物が無ければ available が false になり、
  // 開始忘れの通知だけが無効になる。
  const micUsage = new MicUsageProbe(
    resolveMicWatchBinary({ packaged: app.isPackaged, resourcesPath: process.resourcesPath })
  )
  // モデルは再取得できるキャッシュなので、録音の保存先とは分けて置く。
  const models = new FileModelStore(join(userData, 'models'))

  const library = { repository, artifacts }
  const capture = { repository, capture: recorder, artifacts }

  return {
    settings,
    recorder,
    micUsage,
    startRecording: new StartRecording({
      settings,
      repository,
      capture: recorder,
      artifacts,
      clock: { now: () => new Date() },
      ids: { next: () => randomUUID() }
    }),
    stopRecording: new StopRecording(capture),
    listRecordings: new ListRecordings(library),
    getRecordingDetail: new GetRecordingDetail(library),
    updateNote: new UpdateNote(library),
    renameRecording: new RenameRecording(library),
    renameSpeaker: new RenameSpeaker(library),
    deleteRecording: new DeleteRecording(library),
    listFolders: new ListFolders(folderDeps),
    createFolder: new CreateFolder(folderDeps),
    renameFolder: new RenameFolder(folderDeps),
    moveFolder: new MoveFolder(folderDeps),
    deleteFolder: new DeleteFolder(folderDeps),
    moveRecordingToFolder: new MoveRecordingToFolder(folderDeps),
    updateSettings: new UpdateSettings(settings),
    getSetupState: new GetSetupState(settings),
    getModelStatus: new GetModelStatus(settings, models),
    downloadModel: new DownloadModel(settings, models),
    cancelModelDownload: new CancelModelDownload(models),
    deleteModel: new DeleteModel(settings, models, repository)
  }
}
