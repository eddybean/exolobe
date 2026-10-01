import type { ReleaseFeedPort, ReleaseLookup } from '@application/ports'
import { parseVersion } from '@domain/AppUpdate'

/** fetch のうち、ここで使う部分。テストで代役を渡せるようにする。 */
export type ReleaseFetch = (
  url: string,
  init?: RequestInit
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** 返事を待つ上限。起動直後に裏で走るだけなので、長く待つ理由がない。 */
const TIMEOUT_MS = 10_000

/**
 * GitHub Releases の latest を引く（ADR-044）。
 *
 * latest はドラフトとプレリリースを返さないので、公開した正式版だけが対象になる。
 * 認証はしない。GitHub に届くのは IP アドレスと User-Agent（アプリの名前と版）だけ。
 * 失敗はすべて結果の種類で返し、例外にしない — 通知は付け足しの機能で、
 * 確かめられなかったことを利用者に見せる理由がない。
 */
export class GitHubReleaseFeed implements ReleaseFeedPort {
  private readonly repository: string
  private readonly appVersion: string
  private readonly fetchImpl: ReleaseFetch

  constructor(params: { repository: string; appVersion: string; fetchImpl?: ReleaseFetch }) {
    this.repository = params.repository
    this.appVersion = params.appVersion
    this.fetchImpl = params.fetchImpl ?? globalThis.fetch
  }

  async latest(): Promise<ReleaseLookup> {
    try {
      const response = await this.fetchImpl(`https://api.github.com/repos/${this.repository}/releases/latest`, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': `Exolobe/${this.appVersion}`
        },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      // リポジトリが非公開の間と、まだ Release が 1 つも無いときは 404 になる。
      if (response.status === 404) return { kind: 'none' }
      if (!response.ok) return { kind: 'unreachable' }
      return this.lookupOf(await response.json())
    } catch {
      return { kind: 'unreachable' }
    }
  }

  private lookupOf(body: unknown): ReleaseLookup {
    const tag = typeof body === 'object' && body !== null && 'tag_name' in body ? body.tag_name : undefined
    if (typeof tag !== 'string') return { kind: 'none' }

    const version = parseVersion(tag)
    if (!version) return { kind: 'none' }
    // ページの URL は返事の html_url を使わず自分で組む。開くのは main なので、
    // 検証済みの版だけを埋めた既知の形に限る。
    return {
      kind: 'found',
      release: {
        version: version.join('.'),
        pageUrl: `https://github.com/${this.repository}/releases/tag/${encodeURIComponent(tag)}`
      }
    }
  }
}
