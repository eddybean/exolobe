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

export const defaultSpeakers = (): Speaker[] => [
  { id: SELF_SPEAKER_ID, kind: 'self', label: '自分' },
  { id: REMOTE_SPEAKER_ID, kind: 'remote', label: '参加者' }
]

/** クラスタ名 `spk0`, `spk1`, ... を「参加者A」「参加者B」... の初期ラベルに変換する。 */
export const defaultRemoteLabel = (index: number): string =>
  `参加者${String.fromCharCode('A'.charCodeAt(0) + index)}`
