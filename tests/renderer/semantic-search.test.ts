import { afterEach, describe, expect, it } from 'vitest'
import type { SearchHitDto, SearchIndexStatusDto } from '@shared/ipc'
import { hitLocation, isSemanticSearchAvailable, searchIndexSummary } from '../../src/renderer/library/semanticSearch'
import { setLocale } from '../../src/renderer/i18n/locale'

const hit = (overrides: Partial<SearchHitDto> = {}): SearchHitDto => ({
  recordingId: 'rec-1',
  title: '週次定例',
  startedAt: '2026-09-01T01:00:00.000Z',
  score: 0.62,
  source: 'transcript',
  excerpt: '雨ですね',
  ...overrides
})

const status = (overrides: Partial<SearchIndexStatusDto> = {}): SearchIndexStatusDto => ({
  enabled: true,
  modelInstalled: true,
  indexedCount: 12,
  recordingCount: 15,
  bytes: 3_000_000,
  sync: { state: 'idle' },
  ...overrides
})

describe('hitLocation', () => {
  it('文字起こしで当たったら、どこで話していたかを時刻で示す', () => {
    expect(hitLocation(hit({ startMs: 754_000 }))).toBe('文字起こし 12:34')
  })

  it('要約・メモは出どころだけを示す', () => {
    expect(hitLocation(hit({ source: 'summary' }))).toBe('要約')
    expect(hitLocation(hit({ source: 'note' }))).toBe('メモ')
  })
})

describe('isSemanticSearchAvailable', () => {
  it('有効でモデルがあるときだけ使える', () => {
    expect(isSemanticSearchAvailable(status())).toBe(true)
    expect(isSemanticSearchAvailable(status({ enabled: false }))).toBe(false)
    expect(isSemanticSearchAvailable(status({ modelInstalled: false }))).toBe(false)
    expect(isSemanticSearchAvailable(undefined)).toBe(false)
  })
})

describe('searchIndexSummary', () => {
  it('落ち着いているときは件数と容量を示す', () => {
    expect(searchIndexSummary(status())).toBe('15 件中 12 件を索引済み（3MB）')
  })

  it('作成中は進み具合を示す', () => {
    expect(searchIndexSummary(status({ sync: { state: 'running', done: 3, total: 8 } }))).toBe(
      'インデックスを作成中（3 / 8 件）'
    )
  })

  it('対象を数えている間は件数を出さない', () => {
    expect(searchIndexSummary(status({ sync: { state: 'running', done: 0, total: 0 } }))).toBe('インデックスを確認中…')
  })

  it('録音の処理を待っているときはそう伝える', () => {
    expect(searchIndexSummary(status({ sync: { state: 'waiting' } }))).toBe(
      '録音の処理が終わってからインデックスを作成します'
    )
  })

  it('失敗したら理由を示す', () => {
    expect(searchIndexSummary(status({ sync: { state: 'error', message: 'モデルがありません' } }))).toBe(
      'インデックスを作成できませんでした: モデルがありません'
    )
  })

  it('モデルが無ければ取得を促す', () => {
    expect(searchIndexSummary(status({ modelInstalled: false }))).toBe(
      '上の「モデル」から意味検索モデルをダウンロードしてください'
    )
  })
})

describe('英語表示', () => {
  afterEach(() => setLocale('ja'))

  it('出どころを英語で示す', () => {
    setLocale('en')
    expect(hitLocation(hit({ startMs: 754_000 }))).toBe('Transcript 12:34')
    expect(hitLocation(hit({ source: 'summary' }))).toBe('Summary')
    expect(hitLocation(hit({ source: 'note' }))).toBe('Notes')
  })

  it('索引の状態を英語で示す', () => {
    setLocale('en')
    expect(searchIndexSummary(status())).toBe('12 of 15 indexed (3MB)')
    expect(searchIndexSummary(status({ sync: { state: 'running', done: 3, total: 8 } }))).toBe(
      'Building index (3 of 8)'
    )
  })
})
