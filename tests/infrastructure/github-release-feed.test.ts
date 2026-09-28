import { describe, expect, it } from 'vitest'
import {
  GitHubReleaseFeed,
  type ReleaseFetch
} from '@infrastructure/update/GitHubReleaseFeed'

/** 指定した状態と本文を返す最小のレスポンス。要求は記録して検証する。 */
const respondWith = (
  status: number,
  body: unknown,
  seen: { url?: string; init?: RequestInit | undefined } = {}
): ReleaseFetch => {
  return async (url, init) => {
    seen.url = url
    seen.init = init
    return { ok: status < 400, status, json: async () => body }
  }
}

const feed = (fetchImpl: ReleaseFetch) =>
  new GitHubReleaseFeed({ repository: 'eddybean/exolobe', appVersion: '0.2.2', fetchImpl })

describe('GitHubReleaseFeed', () => {
  it('latest の Release を引き、版と配布ページを返す', async () => {
    const seen: { url?: string; init?: RequestInit | undefined } = {}
    const result = await feed(respondWith(200, { tag_name: 'v0.3.0' }, seen)).latest()

    expect(result).toEqual({
      kind: 'found',
      release: {
        version: '0.3.0',
        pageUrl: 'https://github.com/eddybean/exolobe/releases/tag/v0.3.0'
      }
    })
    expect(seen.url).toBe('https://api.github.com/repos/eddybean/exolobe/releases/latest')
    // GitHub の API は User-Agent の無い要求を断る。届くのはアプリの名前と版だけにする。
    expect(new Headers(seen.init?.headers).get('user-agent')).toBe('Exolobe/0.2.2')
  })

  it('リポジトリが見られない（非公開の間の 404）なら「更新なし」として返す', async () => {
    expect(await feed(respondWith(404, { message: 'Not Found' })).latest()).toEqual({
      kind: 'none'
    })
  })

  it('読めないタグやプレリリース風のタグは「更新なし」として返す', async () => {
    expect(await feed(respondWith(200, { tag_name: 'nightly' })).latest()).toEqual({
      kind: 'none'
    })
    expect(await feed(respondWith(200, { unexpected: true })).latest()).toEqual({ kind: 'none' })
  })

  it('上限超過やサーバーの失敗は「届かなかった」として返す', async () => {
    expect(await feed(respondWith(403, {})).latest()).toEqual({ kind: 'unreachable' })
    expect(await feed(respondWith(502, {})).latest()).toEqual({ kind: 'unreachable' })
  })

  it('通信の例外を投げずに「届かなかった」として返す', async () => {
    const offline: ReleaseFetch = async () => {
      throw new TypeError('fetch failed')
    }

    expect(await feed(offline).latest()).toEqual({ kind: 'unreachable' })
  })
})
