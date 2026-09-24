import type { MicPermissionDto } from '@shared/ipc'

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
