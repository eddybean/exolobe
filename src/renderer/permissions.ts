import type { CalendarPermissionDto, MicPermissionDto, PrivacyPaneDto } from '@shared/ipc'
import type { InputCheckOutcome, InputCheckResult } from './session/runInputCheck'

export interface PermissionView {
  readonly label: string
  readonly ok: boolean
  /** 利用者が次に取れる操作。許可済みなら無い。 */
  readonly action: 'request' | 'open-settings' | undefined
}

/**
 * マイクの許可の状態を、次に何をすればよいかの形にする。
 *
 * まだ聞かれていないときだけ、その場で許可を求められる。一度拒否すると macOS は
 * 二度とダイアログを出さないので、それ以外はシステム設定へ案内するしかない。
 */
export const micPermissionView = (status: MicPermissionDto): PermissionView => {
  switch (status) {
    case 'granted':
      return { label: '許可済み', ok: true, action: undefined }
    case 'not-determined':
      return { label: 'まだ許可していません', ok: false, action: 'request' }
    case 'denied':
    case 'restricted':
      return { label: '許可されていません', ok: false, action: 'open-settings' }
    case 'unknown':
      return { label: '確認できません', ok: false, action: 'open-settings' }
  }
}

/**
 * カレンダーの許可の状態を、次に何をすればよいかの形にする（ADR-040）。
 *
 * 考え方はマイクと同じ。「予定の追加だけ」の許可では予定を読めないので、許可が無いのと同じに扱う。
 * 同梱物が無いときは許可で解決しないので、操作を出さない。
 */
export const calendarPermissionView = (status: CalendarPermissionDto): PermissionView => {
  switch (status) {
    case 'write-only':
      return { label: '予定の追加だけが許可されています', ok: false, action: 'open-settings' }
    case 'unavailable':
      return { label: 'この環境では使えません', ok: false, action: undefined }
    default:
      return micPermissionView(status)
  }
}

export interface InputCheckRow {
  readonly subject: string
  readonly ok: boolean
  /** 取れなかったときの説明と、次にすること。取れたときは空。 */
  readonly message: string
  /** 直す場所がシステム設定なら、その画面。 */
  readonly openSettings: PrivacyPaneDto | undefined
}

/**
 * テスト録音の結果を、何が分かって次に何をすればよいかの形にする。
 *
 * システム音声で確認音が取れなければ、許可が無いとみなす（許可が無いときは無音が
 * 流れるだけなので、それ以外の見分け方が無い）。初めてのテストでは許可のダイアログに
 * 答える前の取り込みが無音のまま終わるので、許可してからもう一度試すよう伝える。
 * マイクに何も入らないのは、話していない・別のマイクを選んでいる、でも起きるので、
 * 許可の問題とは決めつけない。
 */
export const inputCheckView = (result: InputCheckResult): InputCheckRow[] => [
  row('相手の声（システム音声）', result.system, {
    message:
      '確認音が取れませんでした。システム設定でこのアプリの「システムオーディオ録音」を許可してから、もう一度テストしてください。許可のダイアログがいま出た場合は、許可した後にもう一度テストすれば取れます。',
    openSettings: 'system-audio'
  }),
  row('自分の声（マイク）', result.mic, {
    message:
      'マイクに音が入りませんでした。マイクに向かって話しながら、もう一度テストしてください。外付けのマイクを使っている場合は、つながっているかも確かめてください。',
    openSettings: undefined
  })
]

const row = (
  subject: string,
  outcome: InputCheckOutcome,
  whenSilent: { message: string; openSettings: PrivacyPaneDto | undefined }
): InputCheckRow => {
  switch (outcome.kind) {
    case 'heard':
      return { subject, ok: true, message: '', openSettings: undefined }
    case 'silent':
      return { subject, ok: false, ...whenSilent }
    case 'error':
      return { subject, ok: false, message: outcome.message, openSettings: undefined }
  }
}
