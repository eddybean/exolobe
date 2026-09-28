import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { ImportAudioFile } from '@application/usecases/ImportAudioFile'
import { StartRecording } from '@application/usecases/StartRecording'
import { StopRecording } from '@application/usecases/StopRecording'
import { DiscardRecording } from '@application/usecases/DiscardRecording'
import { RecoverInterruptedSteps } from '@application/usecases/RecoverInterruptedSteps'
import {
  CreateFolder,
  DeleteFolder,
  ListFolders,
  MoveFolder,
  MoveRecordingToFolder,
  RenameFolder
} from '@application/usecases/folders'
import {
  ClearVoiceprints,
  DeleteRecording,
  EditSegmentText,
  GetRecordingDetail,
  GetSetupState,
  ListRecordings,
  ListVoiceprints,
  RememberSpeakerVoice,
  RemoveVoiceprint,
  RenameRecording,
  RenameSpeaker,
  UpdateNote,
  AddBookmark,
  UpdateSummary,
  UpdateSettings
} from '@application/usecases/library'
import { ClearSearchIndex, GetSearchIndexStatus } from '@application/usecases/search'
import { SearchTranscripts } from '@application/usecases/SearchTranscripts'
import {
  CancelModelDownload,
  DeleteModel,
  DownloadModel,
  GetModelStatus,
  UpdateModel
} from '@application/usecases/models'
import { AfconvertDecoder } from '@infrastructure/audio/AfconvertDecoder'
import { AudioTeeSource } from '@infrastructure/audio/AudioTeeSource'
import { resolveAudioTeeBinary } from '@infrastructure/audio/resolveAudioTeeBinary'
import { DualTrackRecorder, type SystemAudioSource } from '@infrastructure/audio/DualTrackRecorder'
import { FileFolderRepository } from '@infrastructure/persistence/FileFolderStore'
import { FileVoiceprintRepository } from '@infrastructure/persistence/FileVoiceprintStore'
import { WorkerVoiceExtraction } from './voiceLearning'
import {
  FileRecordingArtifactStore,
  FileRecordingRepository
} from '@infrastructure/persistence/FileRecordingStore'
import { MicUsageProbe } from '@infrastructure/mic/MicUsageProbe'
import { resolveMicWatchBinary } from '@infrastructure/mic/resolveMicWatchBinary'
import { EventKitCalendar } from '@infrastructure/calendar/EventKitCalendar'
import { resolveCalendarBinary } from '@infrastructure/calendar/resolveCalendarBinary'
import { FileModelStore } from '@infrastructure/download/FileModelStore'
import { FileSearchIndex, SEARCH_INDEX_DIR } from '@infrastructure/search/FileSearchIndex'
import { NodeFileInfoProbe } from '@infrastructure/system/NodeFileInfoProbe'
import { NodeSystemResourceProbe } from '@infrastructure/system/NodeSystemResourceProbe'
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
  /** テスト録音用に、録音とは別のシステム音声の取り込みを作る。 */
  readonly createSystemAudioSource: () => SystemAudioSource
  readonly micUsage: MicUsageProbe
  /** 録音開始時の予定の問い合わせと、設定画面での許可の確認に使う（ADR-040）。 */
  readonly calendar: EventKitCalendar
  readonly startRecording: StartRecording
  readonly stopRecording: StopRecording
  readonly importAudioFile: ImportAudioFile
  readonly listRecordings: ListRecordings
  readonly searchTranscripts: SearchTranscripts
  readonly getRecordingDetail: GetRecordingDetail
  readonly updateNote: UpdateNote
  readonly addBookmark: AddBookmark
  readonly updateSummary: UpdateSummary
  readonly renameRecording: RenameRecording
  readonly renameSpeaker: RenameSpeaker
  readonly editSegmentText: EditSegmentText
  readonly rememberSpeakerVoice: RememberSpeakerVoice
  /** 声紋の取り直しの窓。ワーカーを持つ側（IPC 登録時）が実体を差し込む。 */
  readonly voiceExtraction: WorkerVoiceExtraction
  readonly deleteRecording: DeleteRecording
  /** 自動で始めた録音を、パイプラインにかけずに消す（ADR-041）。 */
  readonly discardRecording: DiscardRecording
  /** 実行中のまま残ったステップを失敗に直す。パイプラインが何も動かしていないときだけ呼ぶ。 */
  readonly recoverInterruptedSteps: RecoverInterruptedSteps
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
  readonly updateModel: UpdateModel
  readonly cancelModelDownload: CancelModelDownload
  readonly deleteModel: DeleteModel
  readonly getSearchIndexStatus: GetSearchIndexStatus
  readonly clearSearchIndex: ClearSearchIndex
  readonly listVoiceprints: ListVoiceprints
  readonly removeVoiceprint: RemoveVoiceprint
  readonly clearVoiceprints: ClearVoiceprints
}

export const createContainer = (): Container => {
  const userData = app.getPath('userData')
  const settings = new JsonSettingsRepository(join(userData, 'settings.json'))
  const locator = new SettingsStorageLocator(settings)

  const repository = new FileRecordingRepository(locator)
  const artifacts = new FileRecordingArtifactStore(locator, join(userData, 'work'))
  const folderRepository = new FileFolderRepository(locator)
  const voiceprints = new FileVoiceprintRepository(locator)
  const voiceExtraction = new WorkerVoiceExtraction()
  const folderDeps = {
    folders: folderRepository,
    recordings: repository,
    ids: { next: () => randomUUID() }
  }
  // audiotee は自分の JS の位置からバイナリを探すため、パッケージ済みアプリでは
  // asar 内のパスを解決してしまい起動できない。実パスを明示的に渡す。
  const createSystemAudioSource = (): SystemAudioSource =>
    new AudioTeeSource(
      resolveAudioTeeBinary({ packaged: app.isPackaged, resourcesPath: process.resourcesPath })
    )
  const recorder = new DualTrackRecorder(createSystemAudioSource())
  // 録音していない間だけ動かす見張り。同梱物が無ければ available が false になり、
  // 開始忘れの通知だけが無効になる。
  const micUsage = new MicUsageProbe(
    resolveMicWatchBinary({ packaged: app.isPackaged, resourcesPath: process.resourcesPath })
  )
  // 同梱物が無ければ予定なしとして振る舞い、カレンダー連携だけが無効になる。
  const calendar = new EventKitCalendar(
    resolveCalendarBinary({ packaged: app.isPackaged, resourcesPath: process.resourcesPath })
  )
  // モデルは再取得できるキャッシュなので、録音の保存先とは分けて置く。
  const models = new FileModelStore(join(userData, 'models'))
  // 意味検索の索引も再生成できるキャッシュ。書き込みは検索ワーカーが行い、
  // main は容量の確認と一括削除にだけ使う。
  const searchIndex = new FileSearchIndex(join(userData, SEARCH_INDEX_DIR))

  const library = { repository, artifacts }
  const capture = { repository, capture: recorder, artifacts }

  return {
    settings,
    recorder,
    createSystemAudioSource,
    micUsage,
    calendar,
    startRecording: new StartRecording({
      settings,
      repository,
      capture: recorder,
      artifacts,
      calendar,
      clock: { now: () => new Date() },
      ids: { next: () => randomUUID() }
    }),
    stopRecording: new StopRecording(capture),
    discardRecording: new DiscardRecording(capture),
    recoverInterruptedSteps: new RecoverInterruptedSteps({ repository }),
    // 変換は取り込み時に済ませるので、パイプライン側の結線は増えない（ADR-030）。
    importAudioFile: new ImportAudioFile({
      settings,
      repository,
      artifacts,
      decoder: new AfconvertDecoder(),
      files: new NodeFileInfoProbe(),
      clock: { now: () => new Date() },
      ids: { next: () => randomUUID() }
    }),
    listRecordings: new ListRecordings(library),
    searchTranscripts: new SearchTranscripts(library),
    getRecordingDetail: new GetRecordingDetail(library),
    updateNote: new UpdateNote(library),
    addBookmark: new AddBookmark(library),
    updateSummary: new UpdateSummary(library),
    renameRecording: new RenameRecording(library),
    renameSpeaker: new RenameSpeaker(library),
    editSegmentText: new EditSegmentText(library),
    rememberSpeakerVoice: new RememberSpeakerVoice({
      ...library,
      voiceprints,
      voices: voiceExtraction,
      clock: { now: () => new Date() }
    }),
    voiceExtraction,
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
    updateModel: new UpdateModel(settings, models, repository),
    cancelModelDownload: new CancelModelDownload(models),
    deleteModel: new DeleteModel(settings, models, repository),
    getSearchIndexStatus: new GetSearchIndexStatus({
      settings,
      index: searchIndex,
      repository,
      system: new NodeSystemResourceProbe()
    }),
    clearSearchIndex: new ClearSearchIndex(searchIndex),
    listVoiceprints: new ListVoiceprints(voiceprints),
    removeVoiceprint: new RemoveVoiceprint(voiceprints),
    clearVoiceprints: new ClearVoiceprints(voiceprints)
  }
}
