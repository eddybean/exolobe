import { execFile } from 'node:child_process'
import type { CalendarPort } from '@application/ports'
import type { CalendarEvent } from '@domain/CalendarEvent'
import {
  parseCalendarEvents,
  parseCalendarPermission,
  type CalendarPermission
} from './calendarProtocol'

/**
 * 予定の問い合わせを打ち切るまでの時間。
 *
 * キャプチャは待たずに始まるが、録音の保存はこの応答を待つ。EventKit が
 * 同期中などで固まっても、録音一覧に出るのがこれ以上は遅れないようにする。
 */
const DEFAULT_TIMEOUT_MS = 3_000

/**
 * 権限を求めるダイアログは利用者の操作を待つので、打ち切りを長く取る。
 * 打ち切っても権限の状態は OS 側に残り、次に開いたときの表示で分かる。
 */
const REQUEST_TIMEOUT_MS = 120_000

/**
 * 同梱の calendarevents を通して macOS のカレンダーを読む（ADR-040）。
 *
 * EventKit は Electron からは触れないため、micwatch と同じく小さな Swift の
 * ヘルパーに任せる。TCC は子プロセスの問い合わせを親のアプリに帰属させるので、
 * 許可のダイアログにはアプリの名前と Info.plist の説明文が出る。
 *
 * 失敗はすべて「予定なし」に倒す。連携は録音の付け足しで、ここで例外にすると
 * 録音の開始を巻き込む。
 */
export class EventKitCalendar implements CalendarPort {
  private readonly timeoutMs: number

  constructor(
    private readonly binaryPath: string | undefined,
    options: { timeoutMs?: number } = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async eventsBetween(params: { from: Date; to: Date }): Promise<CalendarEvent[]> {
    const stdout = await this.run(
      ['events', String(params.from.getTime()), String(params.to.getTime())],
      this.timeoutMs
    )
    return stdout === undefined ? [] : parseCalendarEvents(stdout)
  }

  async permission(): Promise<CalendarPermission> {
    if (this.binaryPath === undefined) return 'unavailable'
    const stdout = await this.run(['status'], this.timeoutMs)
    return stdout === undefined ? 'unknown' : parseCalendarPermission(stdout)
  }

  async requestPermission(): Promise<CalendarPermission> {
    if (this.binaryPath === undefined) return 'unavailable'
    const stdout = await this.run(['request'], REQUEST_TIMEOUT_MS)
    return stdout === undefined ? 'unknown' : parseCalendarPermission(stdout)
  }

  /** 正常に終わったときだけ標準出力を返す。 */
  private run(args: string[], timeoutMs: number): Promise<string | undefined> {
    const binaryPath = this.binaryPath
    if (binaryPath === undefined) return Promise.resolve(undefined)

    return new Promise((resolve) => {
      try {
        execFile(binaryPath, args, { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout) =>
          resolve(error ? undefined : stdout)
        )
      } catch {
        resolve(undefined)
      }
    })
  }
}
