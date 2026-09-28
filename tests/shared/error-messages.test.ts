import { describe, expect, it } from 'vitest'
import { AppError, ConfigurationError, RecordingNotFoundError } from '@domain/errors'
import { describeError, describeReason } from '@shared/i18n/errors'

describe('describeReason', () => {
  it('理由を UI の言語の文言にする', () => {
    expect(describeReason({ code: 'alreadyRecording' }, 'ja')).toBe('すでに録音中です。')
    expect(describeReason({ code: 'alreadyRecording' }, 'en')).toBe('Already recording.')
  })

  it('理由が持つ値を文言に埋める', () => {
    const reason = { code: 'recordingNotFound', recordingId: 'abc' } as const
    expect(describeReason(reason, 'ja')).toBe('録音が見つかりません: abc')
    expect(describeReason(reason, 'en')).toBe('Recording not found: abc')
  })

  it('依存ステップの失敗は、そのステップの名前を UI の言語で添える', () => {
    const reason = { code: 'stepBlocked', blocker: 'transcribe' } as const
    expect(describeReason(reason, 'ja')).toBe(
      '前のステップ（文字起こし）が失敗したため実行しませんでした。'
    )
    expect(describeReason(reason, 'en')).toBe(
      'Skipped because an earlier step (Transcription) failed.'
    )
  })

  it('メモリ不足は処理の名前と必要量・空き容量を添える', () => {
    const reason = {
      code: 'insufficientMemory',
      task: 'summarize',
      requiredBytes: 8_000_000_000,
      availableBytes: 4_500_000_000
    } as const
    expect(describeReason(reason, 'ja')).toBe(
      'メモリが不足しているため要約を実行しませんでした（必要 約8.0GB / 空き 約4.5GB）。' +
        '他のアプリを終了してから再実行してください。' +
        '設定の「メモリ保護」で判定の厳しさを変えられます。'
    )
    expect(describeReason(reason, 'en')).toContain('Not enough memory to run summarization')
    expect(describeReason(reason, 'en')).toContain('about 8.0GB needed, about 4.5GB free')
  })

  it('設定の問題は 1 行に 1 つずつ並べる', () => {
    const reason = { code: 'invalidSettings', problems: ['bitrate', 'maxSpeakers'] } as const
    expect(describeReason(reason, 'ja')).toBe(
      'ビットレートは 1kbps 以上を指定してください。\n話者数の上限は 2 以上を指定してください。'
    )
    expect(describeReason(reason, 'en')?.split('\n')).toHaveLength(2)
  })

  /** ffmpeg の同梱は別の決定なので、利用者に ffmpeg を求める文面にはしない。 */
  it('取り込めない理由は取り込める形式を添え、ffmpeg に言及しない', () => {
    const reasons = [
      { code: 'importUnreadableFormat', fileName: 'a.webm', extension: 'webm' },
      { code: 'importNotAudio', fileName: 'memo.txt' },
      { code: 'importNoExtension', fileName: 'recording' }
    ] as const
    for (const locale of ['ja', 'en'] as const) {
      for (const reason of reasons) {
        const text = describeReason(reason, locale)
        expect(text).toContain(reason.fileName)
        expect(text).toContain('mp3')
        expect(text).not.toContain('ffmpeg')
      }
    }
  })

  it('知らないコード（新しい版が保存した理由など）は undefined を返す', () => {
    const unknown = { code: 'fromTheFuture' } as unknown as Parameters<typeof describeReason>[0]
    expect(describeReason(unknown, 'en')).toBeUndefined()
  })
})

describe('describeError', () => {
  it('理由を持つエラーは理由から文言を引く', () => {
    expect(describeError(new RecordingNotFoundError('x'), 'en')).toBe('Recording not found: x')
    expect(describeError(new ConfigurationError({ code: 'titleRequired' }), 'ja')).toBe(
      'タイトルを入力してください。'
    )
  })

  it('理由の無いエラーは元のメッセージをそのまま返す', () => {
    expect(describeError(new Error('ENOENT: no such file'), 'ja')).toBe('ENOENT: no such file')
    expect(describeError('boom', 'en')).toBe('boom')
  })

  it('知らない理由を持つエラーはコードを返す（空の文言にしない）', () => {
    const error = new AppError({ code: 'fromTheFuture' } as never)
    expect(describeError(error, 'ja')).toBe('fromTheFuture')
  })
})
