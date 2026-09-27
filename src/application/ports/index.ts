import type { CalendarEvent } from '@domain/CalendarEvent'
import type { Folder } from '@domain/Folder'
import type { MemorySnapshot } from '@domain/MemoryGuard'
import type { Bookmark } from '@domain/MeetingNotes'
import type { PipelineStep, Recording } from '@domain/Recording'
import type { DualTrackSource, RecordingSource } from '@domain/RecordingSource'
import type { ChunkLocator, SearchSource } from '@domain/SemanticSearch'
import type { AudioCodec, Settings, SettingsPatch } from '@domain/Settings'
import type { Speaker } from '@domain/Speaker'
import type { SpeakerTurn, TranscriptSegment } from '@domain/TranscriptSegment'
import type { RecordingVoices, Voiceprint } from '@domain/Voiceprint'

/**
 * 内側の層が外界に触れるための境界。実装はすべて infrastructure 層に置き、
 * main/container.ts でのみ結線する。ユースケースはここの型しか知らない。
 */

/** 現在時刻。テストで固定できるよう注入する。 */
export interface ClockPort {
  now(): Date
}

/** 録音 ID の採番。 */
export interface IdGeneratorPort {
  next(): string
}

/**
 * パイプラインが読む音の素材。定義は domain にあり、ここからは再公開するだけ。
 * 内側の層（ユースケース）が「録音か取り込みか」を業務の語彙で扱えるようにするため。
 */
export type { DualTrackSource, ImportedTrackSource, RecordingSource } from '@domain/RecordingSource'
export type { RecordingVoices, SpeakerVector, Voiceprint } from '@domain/Voiceprint'

export interface AudioCapturePort {
  start(params: { workDir: string; sampleRate: number }): Promise<void>
  /** 録音は常に 2 トラックなので、取り込みを含む union より狭い型を返す。 */
  stop(): Promise<DualTrackSource>
  isActive(): boolean
  /**
   * 前回の読み出し以降に届いたシステム音声の peak（0〜1）。
   * UI の入力レベル表示専用で、録音の成果物には影響しない。
   */
  systemLevel(): number
}

/** 2 トラックを時刻整列して 1 本の WAV にまとめる。 */
export interface AudioMixerPort {
  mix(params: {
    tracks: readonly { path: string; offsetMs: number }[]
    outputPath: string
  }): Promise<{ durationMs: number }>
}

/**
 * 取り込んだ音声を、文字起こしが読める 16bit PCM の WAV へ変換する。
 * エンコード（配布用の圧縮）とは向きが逆なので別のポートにする。
 */
export interface AudioDecoderPort {
  decode(params: {
    inputPath: string
    outputPath: string
    sampleRate: number
  }): Promise<{ durationMs: number }>
}

/** WAV を配布用の圧縮音声へ変換する。 */
export interface AudioEncoderPort {
  encode(params: {
    inputPath: string
    outputPath: string
    codec: AudioCodec
    bitrateKbps: number
  }): Promise<void>
}

export interface TranscriptionPort {
  transcribe(params: {
    wavPath: string
    language: string
    /** 得られた全セグメントに付与する話者 ID。トラック＝話者なので呼び出し側が決める。 */
    speakerId: string
    signal?: AbortSignal
    /** そのトラックの進み具合（0〜1）。出せない実装は呼ばなくてよい。 */
    onProgress?: (fraction: number) => void
  }): Promise<TranscriptSegment[]>
}

export interface DiarizationPort {
  diarize(params: {
    wavPath: string
    maxSpeakers: number
    signal?: AbortSignal
  }): Promise<SpeakerTurn[]>
}

/**
 * 話者クラスタごとの声紋を取り出す。
 *
 * 話者分割（誰と誰が別人か）とは別の仕事なので port を分ける。分割は
 * 1 つの録音の中で閉じるが、こちらは録音をまたいで同じ人を指すための値を作る。
 */
export interface SpeakerEmbeddingPort {
  /** 埋め込みモデルの識別子。変われば過去に作った声紋とは比較できない。 */
  readonly modelKey: string
  /**
   * `speaker` はダイアライザが付けたクラスタ名（例: `spk0`）。
   * `vector` は**長さ 1 に正規化済み**で返す。照合を内積だけで行うため。
   */
  embedSpeakers(params: {
    wavPath: string
    turns: readonly SpeakerTurn[]
    signal?: AbortSignal
  }): Promise<{ readonly speaker: string; readonly vector: Float32Array }[]>
}

/**
 * 声紋帳。保存先ルートの voiceprints.json が実体。
 *
 * 索引（SearchIndexPort）と違い再生成できない。利用者が名前を付けた事実そのもので、
 * 元の録音を消しても残す（ADR-031）。
 */
export interface VoiceprintRepositoryPort {
  list(): Promise<Voiceprint[]>
  /** 名前を鍵に 1 件を置く。同じ名前があれば差し替える。 */
  put(voiceprint: Voiceprint): Promise<void>
  remove(name: string): Promise<void>
  clear(): Promise<void>
}

/** 対話の 1 ターン。system は履歴に含めない（問いのたびに作り直すため）。 */
export interface ChatTurn {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

/** 生成の結果。途中で打ち切られたかどうかまでを含む。 */
export interface ChatCompletion {
  readonly text: string
  /** 上限に達して書ききれなかったか。黙って尻切れにしないため。 */
  readonly truncated: boolean
}

/**
 * 会話形式の生成。
 *
 * SummarizationPort とは統合しない。あちらは「文字起こし 1 本 → 議事録 1 本」で、
 * 分割と統合という業務ルールを実装の内側に抱えている。こちらは「履歴＋文脈 →
 * 逐次出力」で、要求が重ならない。既存に onChunk を足せば、使わない ProcessRecording
 * まで引数を運ぶことになる。同じネイティブライブラリを使うのは infrastructure の
 * 事情であって、契約を一緒にする理由にはならない。
 */
export interface ChatCompletionPort {
  complete(params: {
    system: string
    history: readonly ChatTurn[]
    prompt: string
    /** 生成中の断片。呼び出し側が画面へ流す。 */
    onChunk: (text: string) => void
    signal?: AbortSignal
  }): Promise<ChatCompletion>
}

/**
 * 話題語で録音の候補を絞る。
 *
 * 意味検索の実体（埋め込みモデル）は数 GB の LLM と同居させられないので別プロセスに置く。
 * ユースケースからは録音 ID の配列を返すだけの窓にしておき、どこで解決するかを問わない。
 */
export interface RecordingFinderPort {
  find(params: { topic: string; limit: number }): Promise<readonly string[]>
}

export interface SummarizationPort {
  summarize(params: {
    transcript: string
    /** 録音中に書いたメモと印（ADR-042）。無ければ空文字。 */
    notes?: string
    promptTemplate: string
    signal?: AbortSignal
  }): Promise<string>
}

/**
 * OS 側の資源。重い推論に入る前の判断材料をユースケースへ渡す。
 *
 * ファイルサイズを同居させているのは、所要メモリの見積もりに実ファイルの大きさが
 * 要るため。ModelCatalog の bytes はカタログ上の期待値でしかなく、利用者が自分の
 * GGUF を選んだ場合には当てにならない。
 */
export interface SystemResourcePort {
  memory(): Promise<MemorySnapshot>
  /** 存在しない・読めない場合は undefined。 */
  fileSize(path: string): Promise<number | undefined>
}

/**
 * 取り込み元ファイルの素性。
 *
 * SystemResourcePort にもファイルサイズはあるが、あちらは所要メモリの見積もり用で
 * 「いつの音声か」を扱う場所ではないため分ける。
 */
export interface FileInfoPort {
  /** 存在しない・読めない場合は undefined。 */
  stat(path: string): Promise<{ readonly sizeBytes: number; readonly modifiedAt: Date } | undefined>
}

/**
 * 端末のカレンダー（macOS では EventKit）。読むだけで、外へは何も送らない（ADR-040）。
 *
 * 権限が無い・カレンダーが使えない場合は空配列を返せばよい。ユースケースは
 * 予定が無いときと同じく従来の振る舞いに戻る。
 */
export interface CalendarPort {
  /** from〜to の区間に少しでも重なる予定。 */
  eventsBetween(params: { from: Date; to: Date }): Promise<CalendarEvent[]>
}

/** 録音のメタデータ一覧。保存先ルート配下の index.json が実体。 */
export interface RecordingRepositoryPort {
  list(): Promise<Recording[]>
  find(id: string): Promise<Recording | undefined>
  save(recording: Recording): Promise<void>
  remove(id: string): Promise<void>
}

/**
 * 完了済みの録音から声紋を取り直す。
 *
 * 実体はネイティブの埋め込みモデルを読む重い処理で、main プロセスでは動かさない
 * （ADR-008）。ユースケースからは「必要なら用意される」ことだけが見えていればいい。
 */
export interface VoiceExtractionPort {
  extract(recordingId: string): Promise<void>
}

/** 1 件の録音に紐づくファイル群（音声・文字起こし・要約・メモ）。 */
export interface RecordingArtifactPort {
  workDir(recording: Recording): string
  /** 保存先に置く最終音声のパス。保存先は設定で変わるため非同期に解決する。 */
  audioPath(recording: Recording): Promise<string>

  /**
   * パイプラインの入力となる音の素材。アプリ再起動後のリトライで必要になる。
   * メソッド名と保存先のファイル名（tracks.json）は 2 トラック録音しか無かった頃のまま。
   */
  readTracks(recording: Recording): Promise<RecordingSource | undefined>
  writeTracks(recording: Recording, tracks: RecordingSource): Promise<void>

  readTranscript(
    recording: Recording
  ): Promise<{ segments: TranscriptSegment[]; speakers: Speaker[] } | undefined>
  writeTranscript(
    recording: Recording,
    data: { segments: readonly TranscriptSegment[]; speakers: readonly Speaker[] }
  ): Promise<void>

  /**
   * 話者ごとの声紋。名前を付けるのはパイプラインが終わった後なので、
   * そのときには work/ の WAV が消えている。録音と一緒に残しておく。
   */
  readVoices(recording: Recording): Promise<RecordingVoices | undefined>
  writeVoices(recording: Recording, voices: RecordingVoices): Promise<void>

  /**
   * 声紋を取り直すための一時 WAV を貸す。`run` が終わったら必ず捨てる。
   *
   * 1 時間の会議で約 115MB になる（16kHz モノラル 16bit）。抜けると保存先ではなく
   * userData がじわじわ埋まり、利用者からは見えない。
   */
  withVoicesWav<T>(recording: Recording, run: (wavPath: string) => Promise<T>): Promise<T>

  readSummary(recording: Recording): Promise<string | undefined>
  writeSummary(recording: Recording, markdown: string): Promise<void>

  readNote(recording: Recording): Promise<string>
  writeNote(recording: Recording, markdown: string): Promise<void>

  /** 録音中に「今の発言に印をつける」を押した時点（ADR-042）。無ければ空。 */
  readBookmarks(recording: Recording): Promise<Bookmark[]>
  writeBookmarks(recording: Recording, bookmarks: readonly Bookmark[]): Promise<void>

  /** エンコード後に不要になる中間 WAV を片付ける。 */
  cleanupIntermediates(recording: Recording): Promise<void>
  removeAll(recording: Recording): Promise<void>
}

/** フォルダの定義（id/名前/親子関係）。保存先ルートの folders.json が実体。 */
export interface FolderRepositoryPort {
  list(): Promise<Folder[]>
  replaceAll(folders: readonly Folder[]): Promise<void>
}

export interface SettingsRepositoryPort {
  load(): Promise<Settings>
  save(patch: SettingsPatch): Promise<Settings>
}

/** パイプラインの進捗を UI へ伝える。 */
export interface ProgressReporterPort {
  report(event: {
    recordingId: string
    step: PipelineStep
    status: 'running' | 'done' | 'failed'
    error?: string
    /** running の途中経過（0〜1）。割合を出せるステップだけが付ける。 */
    fraction?: number
  }): void
}

/** 文字列を意味のベクトルにする（意味検索用）。 */
export interface TextEmbedderPort {
  /**
   * 埋め込みの互換性を表すキー。モデルが変われば値が変わり、
   * それ以前に作ったベクトルとは比較できない。
   */
  readonly modelKey: string
  /**
   * モデルを読み込み済みか。
   * 読み込み済みならメモリは既に確保されているので、所要量を二重に数えない。
   */
  readonly loaded: boolean
  /** 長さ 1 に正規化したベクトルを返す。 */
  embed(text: string): Promise<Float32Array>
}

export interface IndexedChunk {
  readonly source: SearchSource
  readonly locator: ChunkLocator
  readonly vector: Float32Array
}

/** 1 件の録音の索引。本文は持たず、位置とベクトルだけを持つ。 */
export interface SearchIndexEntry {
  readonly recordingId: string
  readonly fingerprint: string
  readonly modelKey: string
  readonly chunks: readonly IndexedChunk[]
}

/** 意味検索の索引。再生成できるキャッシュであり、消えても録音は失われない。 */
export interface SearchIndexPort {
  list(): Promise<SearchIndexEntry[]>
  put(entry: SearchIndexEntry): Promise<void>
  remove(recordingId: string): Promise<void>
  clear(): Promise<void>
  /** 索引が占めている件数と容量。設定画面で消すかどうかの判断材料にする。 */
  stats(): Promise<{ count: number; bytes: number }>
}
