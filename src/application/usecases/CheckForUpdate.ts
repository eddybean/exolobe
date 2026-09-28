import type {
  ClockPort,
  InstallSourcePort,
  PublishedRelease,
  ReleaseFeedPort,
  SettingsRepositoryPort,
  UpdateCheckRecord,
  UpdateCheckStorePort
} from '@application/ports'
import { isNewerVersion, isUpdateCheckDue, type InstallSource } from '@domain/AppUpdate'
import { updateCheckIntervalOf } from '@domain/Settings'

export interface CheckForUpdateDeps {
  readonly settings: SettingsRepositoryPort
  readonly releases: ReleaseFeedPort
  readonly store: UpdateCheckStorePort
  readonly installation: InstallSourcePort
  readonly clock: ClockPort
  /** いま動いているアプリの版（`0.2.2`）。 */
  readonly currentVersion: string
}

export interface UpdateStatus {
  readonly currentVersion: string
  /** 最後に配布元の返事を得た時刻。一度も得ていなければ undefined。 */
  readonly checkedAt: Date | undefined
  /** 今の版より新しい版。無ければ undefined。 */
  readonly available: (PublishedRelease & { readonly installSource: InstallSource }) | undefined
}

/**
 * 新しい版があるかを確かめる（ADR-044）。
 *
 * 問い合わせは設定の間隔ごとに 1 度だけで、その間は覚えた結果で答える。見つけた版は
 * 次に確かめるまで覚えておき、再起動しても知らせ続ける。`force` は利用者が
 * 「今すぐ確認」を押したときで、間隔も「確認しない」も越えて問い合わせる。
 */
export class CheckForUpdate {
  constructor(private readonly deps: CheckForUpdateDeps) {}

  async execute(options: { force?: boolean } = {}): Promise<UpdateStatus> {
    const interval = updateCheckIntervalOf(await this.deps.settings.load())
    const now = this.deps.clock.now()
    let record = await this.deps.store.load()

    if (options.force || isUpdateCheckDue({ interval, lastCheckedAt: record?.checkedAt, now })) {
      record = (await this.lookUp(now)) ?? record
    }

    // 確認しない設定の人には、以前に見つけた版も出さない。自分で確かめたときだけ見せる。
    const shows = options.force || interval !== 'never'
    return this.statusOf(shows ? record : undefined, record?.checkedAt)
  }

  /** 返事が得られなければ undefined（記録を変えない）。 */
  private async lookUp(now: Date): Promise<UpdateCheckRecord | undefined> {
    const lookup = await this.deps.releases.latest()
    if (lookup.kind === 'unreachable') return undefined

    const record = { checkedAt: now, latest: lookup.kind === 'found' ? lookup.release : undefined }
    await this.deps.store.save(record)
    return record
  }

  private async statusOf(
    record: UpdateCheckRecord | undefined,
    checkedAt: Date | undefined
  ): Promise<UpdateStatus> {
    const latest = record?.latest
    const available =
      latest && isNewerVersion(latest.version, this.deps.currentVersion)
        ? { ...latest, installSource: await this.deps.installation.detect() }
        : undefined
    return { currentVersion: this.deps.currentVersion, checkedAt, available }
  }
}
