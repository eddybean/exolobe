import type { CalendarPermissionDto, MicPermissionDto, PrivacyPaneDto } from '@shared/ipc'
import { permissionsText } from './i18n/permissions'
import { platform } from './platform'
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
  const t = permissionsText()
  switch (status) {
    case 'granted':
      return { label: t.micGranted, ok: true, action: undefined }
    case 'not-determined':
      return { label: t.micNotDetermined, ok: false, action: 'request' }
    case 'denied':
    case 'restricted':
      return { label: t.micDenied, ok: false, action: 'open-settings' }
    case 'unknown':
      return { label: t.micUnknown, ok: false, action: 'open-settings' }
  }
}

/**
 * カレンダーの許可の状態を、次に何をすればよいかの形にする（ADR-040）。
 *
 * 考え方はマイクと同じ。「予定の追加だけ」の許可では予定を読めないので、許可が無いのと同じに扱う。
 * 同梱物が無いときは許可で解決しないので、操作を出さない。
 */
export const calendarPermissionView = (status: CalendarPermissionDto): PermissionView => {
  const t = permissionsText()
  switch (status) {
    case 'write-only':
      return { label: t.calendarWriteOnly, ok: false, action: 'open-settings' }
    case 'unavailable':
      return { label: t.calendarUnavailable, ok: false, action: undefined }
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
export const inputCheckView = (result: InputCheckResult): InputCheckRow[] => {
  const t = permissionsText()
  return [
    row(t.systemAudioSubject, result.system, {
      message: t.systemAudioMessage(platform()),
      // Windows はシステム音声の取り込みに許可が無い（ADR-048）。開く画面が無いので案内しない。
      openSettings: platform() === 'windows' ? undefined : 'system-audio'
    }),
    row(t.micSubject, result.mic, {
      message: t.micMessage,
      openSettings: undefined
    })
  ]
}

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
