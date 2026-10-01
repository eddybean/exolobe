import type {
  AudioDecoderPort,
  ClockPort,
  FileInfoPort,
  IdGeneratorPort,
  RecordingArtifactPort,
  RecordingRepositoryPort,
  SettingsRepositoryPort
} from '@application/ports'
import { type ImportFormats, importTitleOf, unsupportedImportReason } from '@domain/AudioImport'
import { createRecording, finishRecording, tooShortRecording, type Recording } from '@domain/Recording'
import { ConfigurationError, TooShortRecordingError, UnsupportedAudioFormatError } from '@domain/errors'
import { isConfigured } from '@domain/Settings'

export interface ImportAudioFileDeps {
  readonly settings: SettingsRepositoryPort
  readonly repository: RecordingRepositoryPort
  readonly artifacts: RecordingArtifactPort
  readonly decoder: AudioDecoderPort
  readonly files: FileInfoPort
  readonly clock: ClockPort
  readonly ids: IdGeneratorPort
  /** decoder が読める形式。変換器ごとに違うので、decoder と組で結線から渡す。 */
  readonly formats: ImportFormats
}

/** 変換後の WAV の名前。system.wav / mic.wav と同じ階層に並ぶパイプラインの入力。 */
const IMPORTED_WAV = 'imported.wav'

/**
 * 手元の音声ファイルから録音を作り、文字起こし以降のパイプラインに渡せる状態にする。
 *
 * 変換をここで済ませるのが設計の要点。PIPELINE_STEPS に変換のステップを足すと、
 * 既にあるステップ一覧を持たない過去の録音は新しいステップが未実行のまま残り、
 * 全体の状態が永久に「処理中」になる（ADR-030）。変換後の WAV は停止時に書かれる
 * トラック情報と同じ「パイプラインの入力」なので、StopRecording と同じ位置に置く。
 */
export class ImportAudioFile {
  constructor(private readonly deps: ImportAudioFileDeps) {}

  async execute(params: { filePath: string; folderId?: string }): Promise<Recording> {
    const settings = await this.deps.settings.load()
    if (!isConfigured(settings)) {
      throw new ConfigurationError({ code: 'storageNotConfigured' })
    }

    // 拡張子で断れるものはディスクに触る前に断る。
    const unsupported = unsupportedImportReason(params.filePath, this.deps.formats)
    if (unsupported) {
      throw new UnsupportedAudioFormatError(unsupported)
    }

    const info = await this.deps.files.stat(params.filePath)
    if (!info) {
      throw new ConfigurationError({ code: 'fileUnreadable', path: params.filePath })
    }

    // 録音はまだ永続化しない。作業ディレクトリの場所は id だけで決まるため、
    // 変換が失敗したときに空の録音を一覧へ残さずに済む（StartRecording と同じ順序）。
    const recording = createRecording({
      id: this.deps.ids.next(),
      startedAt: startedAtOf(info.modifiedAt, this.deps.clock),
      title: importTitleOf(params.filePath)
    })

    const wavPath = `${this.deps.artifacts.workDir(recording)}/${IMPORTED_WAV}`
    const { durationMs } = await this.deps.decoder.decode({
      inputPath: params.filePath,
      outputPath: wavPath,
      sampleRate: settings.audio.sampleRate
    })

    /*
     * 短すぎる音声は録音を作る前に断る。
     *
     * 録音では停止した時点で録音が既に存在するため、ProcessRecording が全ステップを
     * 失敗として記録するしかない。取り込みは利用者がファイルを選んだ直後なので、
     * その場で理由を返せる。作ってから畳むと、手で消すしかない行が一覧に残る。
     */
    const tooShort = tooShortRecording(durationMs)
    if (tooShort) {
      await this.deps.artifacts.cleanupIntermediates(recording)
      throw new TooShortRecordingError(tooShort)
    }

    const imported: Recording = {
      ...finishRecording(recording, durationMs),
      ...(params.folderId === undefined ? {} : { folderId: params.folderId })
    }

    await this.deps.artifacts.writeTracks(imported, {
      kind: 'single',
      wavPath,
      durationMs
    })
    await this.deps.repository.save(imported)

    return imported
  }
}

/**
 * 取り込んだ音声の開始日時。
 *
 * ファイルの更新日時を使う。一覧は開始日時順に並び、保存ディレクトリ名もそこから作るので、
 * 取り込んだ時刻にすると 3 年前の会議が今日の録音の隣に来てしまう。読めなければ現在時刻に
 * 落とす（測れないことを理由に取り込みを断らない）。
 */
const startedAtOf = (modifiedAt: Date, clock: ClockPort): Date =>
  Number.isFinite(modifiedAt.getTime()) ? modifiedAt : clock.now()
