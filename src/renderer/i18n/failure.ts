import type { ErrorReason } from '@domain/errors'
import { describeReason } from '@shared/i18n/errors'
import { locale } from './locale'

/** 理由を今の UI の言語の文言にする。 */
export const reasonText = (reason: ErrorReason): string => describeReason(reason, locale()) ?? reason.code

/**
 * 保存されたステップの失敗を文言にする。
 *
 * 理由があれば今の言語で引き直す。理由の無い失敗（ネイティブ由来）や、新しい版が保存した
 * 知らない理由は、保存されていたメッセージのまま出す。
 */
export const failureText = (failure: {
  readonly error?: string | undefined
  readonly reason?: ErrorReason | undefined
}): string | undefined => (failure.reason && describeReason(failure.reason, locale())) ?? failure.error
