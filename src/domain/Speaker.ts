import type { MeetingLanguage } from '@domain/MeetingLanguage'

/** 話者の由来。マイクトラック＝自分、システム音声トラック＝相手で確定する。 */
export type SpeakerKind = 'self' | 'remote'

export interface Speaker {
  /** `self` または `remote`、話者クラスタリング適用後は `remote:<クラスタ名>`。 */
  readonly id: string
  readonly kind: SpeakerKind
  /** 画面に表示する名前。ユーザーが詳細画面で変更できる。 */
  readonly label: string
}

export const SELF_SPEAKER_ID = 'self'
export const REMOTE_SPEAKER_ID = 'remote'

/** クラスタリング結果の話者 ID は `remote:` 前置きで名前空間を分ける。 */
export const remoteSpeakerId = (cluster: string): string => `${REMOTE_SPEAKER_ID}:${cluster}`

export const isRemoteSpeakerId = (id: string): boolean =>
  id === REMOTE_SPEAKER_ID || id.startsWith(`${REMOTE_SPEAKER_ID}:`)

/**
 * 話者の既定名。会議の言語で付ける（ADR-043）。
 *
 * 文字起こし（transcript.md）と要約の入力に書き込まれるので、UI の言語ではなく会議の言語に
 * 揃える。付けた後は利用者の名前と同じく保存され、言語を変えても書き換わらない。
 */
const DEFAULT_LABELS: Readonly<
  Record<
    MeetingLanguage,
    { readonly self: string; readonly group: string; readonly numbered: (letter: string) => string }
  >
> = {
  ja: { self: '自分', group: '参加者', numbered: (letter) => `参加者${letter}` },
  en: { self: 'Me', group: 'Participants', numbered: (letter) => `Participant ${letter}` }
}

const letterOf = (index: number): string => String.fromCharCode('A'.charCodeAt(0) + index)

export const defaultSelfLabel = (language: MeetingLanguage): string => DEFAULT_LABELS[language].self

/** 話者識別をしないとき、相手側をまとめて呼ぶ名前。 */
export const defaultRemoteGroupLabel = (language: MeetingLanguage): string => DEFAULT_LABELS[language].group

/** クラスタ名 `spk0`, `spk1`, ... を「参加者A」「参加者B」... の初期ラベルに変換する。 */
export const defaultRemoteLabel = (index: number, language: MeetingLanguage): string =>
  DEFAULT_LABELS[language].numbered(letterOf(index))

/**
 * 既定の採番そのものか。どの言語の既定名も既定とみなす。
 *
 * 言語を変えて話者識別をやり直したとき、前の言語の「参加者A」を利用者が付けた名前と
 * 取り違えると、声紋の引き当てに譲れなくなる。
 */
export const isDefaultRemoteLabel = (label: string, index: number): boolean =>
  Object.values(DEFAULT_LABELS).some((labels) => labels.numbered(letterOf(index)) === label)
