import { describe } from './i18n'
import type { SearchSyncStateDto } from '@shared/ipc'

export type SearchSyncState = SearchSyncStateDto

/**
 * 意味検索の索引を録音一覧に合わせる同期を、いつ走らせるかを決める。
 *
 * 同期の起点（起動・パイプライン完了・メモ編集・リネーム…）は多く、短い間に
 * 重なる。依頼を束ねて 1 回にし、同時に 2 本走らせない。
 * 録音やその後処理の間は待たせる。要約の LLM と埋め込みモデルを同時に載せると
 * 16GB 機では足りなくなり、会議アプリの音声まで途切れかねないため。
 *
 * 待たせた同期を自分では再開しない。パイプラインが空いたときに呼び出し側が
 * もう一度 request する。タイマーで様子を見に行くより、起点が 1 本で済む。
 */
export interface SearchSyncScheduler {
  request(): void
  /** 索引を消した後に呼ぶ。待機中の依頼と、止めた同期の結果を捨てる。 */
  reset(): void
  state(): SearchSyncState
}

export const createSearchSyncScheduler = (params: {
  isEnabled: () => Promise<boolean>
  isBusy: () => boolean
  run: (onProgress: (done: number, total: number) => void) => Promise<void>
  onStateChange: (state: SearchSyncState) => void
  debounceMs?: number
}): SearchSyncScheduler => {
  const debounceMs = params.debounceMs ?? 3_000
  let current: SearchSyncState = { state: 'idle' }
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let rerun = false
  // reset のたびに進める。古い世代の同期が後から終わっても状態を書き換えさせない。
  let generation = 0

  const setState = (next: SearchSyncState): void => {
    current = next
    params.onStateChange(next)
  }

  const trigger = async (): Promise<void> => {
    if (running) {
      rerun = true
      return
    }
    if (!(await params.isEnabled())) {
      setState({ state: 'idle' })
      return
    }
    if (params.isBusy()) {
      setState({ state: 'waiting' })
      return
    }

    const mine = generation
    running = true
    setState({ state: 'running', done: 0, total: 0 })
    try {
      await params.run((done, total) => {
        if (mine === generation) setState({ state: 'running', done, total })
      })
      // パイプラインに譲って途中で止めた場合は、空いた後の依頼で続きをやる。
      if (mine === generation) {
        setState(params.isBusy() ? { state: 'waiting' } : { state: 'idle' })
      }
    } catch (error: unknown) {
      if (mine === generation) setState({ state: 'error', message: describe(error) })
    } finally {
      running = false
    }

    if (rerun) {
      rerun = false
      request()
    }
  }

  const request = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void trigger()
    }, debounceMs)
  }

  return {
    request,
    reset(): void {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      rerun = false
      generation += 1
      setState({ state: 'idle' })
    },
    state: () => current
  }
}
