import { REMOTE_SPEAKER_ID, SELF_SPEAKER_ID } from './Speaker'

/**
 * パイプラインが読む「音の素材」。
 *
 * 録音と取り込みで形が違うのに、後段（ミックス・文字起こし・話者識別）は同じ 5 ステップを
 * 通る。どちらであるかを kind で名乗らせ、分岐を*不在*の検査（「マイクのパスが無ければ
 * 取り込み」）にしない。マイクが取れなかった録音でも mic.wav は空のファイルとして残るため
 * （ADR-017）、パスの有無では 2 つの状況を区別できない。
 */

/** 2 トラック録音。トラック＝話者が録音時に確定している（ADR-006）。 */
export interface DualTrackSource {
  readonly kind: 'dual'
  readonly systemWavPath: string
  readonly micWavPath: string
  /** マイクトラックがシステム音声より遅れて開始した量。負なら先行。 */
  readonly micOffsetMs: number
  readonly durationMs: number
}

/**
 * 取り込んだ音声ファイルを 16kHz モノラルの WAV に変換したもの。
 *
 * 1 本のファイルには「どの声が誰か」という情報が原理的に無い。自分の声を推定して
 * 割り当てると、外したときに「自分が言っていない発言を自分のものとして残す」という
 * 最も高価な間違いになるため、全体を相手側として扱い、人数の分離は話者識別に任せる。
 */
export interface ImportedTrackSource {
  readonly kind: 'single'
  readonly wavPath: string
  readonly durationMs: number
}

export type RecordingSource = DualTrackSource | ImportedTrackSource

/**
 * ミックスに渡すトラック並び。
 *
 * 単一ソースでも 1 件の配列になるので TrackMixer はそのまま動く。取り込みのために
 * ミックスを飛ばすことはしない。飛ばすとエンコードが「何もしなかったミックス」に
 * 依存する状態になり、ステップ 1 つの意味が素材の種類で 2 つに割れる。
 */
export const mixInputs = (
  source: RecordingSource
): readonly { readonly path: string; readonly offsetMs: number }[] =>
  source.kind === 'dual'
    ? [
        { path: source.systemWavPath, offsetMs: 0 },
        { path: source.micWavPath, offsetMs: source.micOffsetMs }
      ]
    : [{ path: source.wavPath, offsetMs: 0 }]

/**
 * 文字起こしの対象。どの WAV をどの話者 ID で起こすか。
 *
 * 2 トラックはマイク＝自分・システム音声＝相手が録音時に確定しているので、推論なしで
 * 2 話者を分けられる（ADR-006）。取り込んだ 1 本にはその情報が無いため全体を相手側とし、
 * 何人いるかは話者識別に任せる。
 */
export const transcriptionTargets = (
  source: RecordingSource
): readonly { readonly wavPath: string; readonly speakerId: string }[] =>
  source.kind === 'dual'
    ? [
        { wavPath: source.micWavPath, speakerId: SELF_SPEAKER_ID },
        { wavPath: source.systemWavPath, speakerId: REMOTE_SPEAKER_ID }
      ]
    : [{ wavPath: source.wavPath, speakerId: REMOTE_SPEAKER_ID }]

/**
 * 話者識別にかける WAV。
 *
 * 2 トラックは相手側だけでよい。自分の発話は確定しているので推論に掛ける必要がなく、
 * その分だけ精度と処理時間の両方で有利になる。取り込みは全体が対象。
 */
export const diarizationTarget = (source: RecordingSource): string =>
  source.kind === 'dual' ? source.systemWavPath : source.wavPath
