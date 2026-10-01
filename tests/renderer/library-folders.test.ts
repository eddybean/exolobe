import { afterEach, describe, expect, it } from 'vitest'
import {
  acceptedDrop,
  filterByQuery,
  folderChipRows,
  folderNameLookup,
  folderPathLabel,
  recordingsInFolder,
  resolveFolderKey
} from '@renderer/library/folders'
import type { FolderDto, RecordingDto } from '@shared/ipc'
import { FOLDER_MIME, RECORDING_MIME } from '@renderer/library/fileDrop'
import { setLocale } from '@renderer/i18n/locale'

const folder = (id: string, name: string, parentId?: string): FolderDto => ({
  id,
  name,
  ...(parentId === undefined ? {} : { parentId })
})

const recording = (id: string, folderId?: string, title = id): RecordingDto => ({
  id,
  title,
  startedAt: '2026-09-24T05:00:00.000Z',
  durationMs: 60_000,
  status: 'ready',
  steps: {} as RecordingDto['steps'],
  slug: id,
  ...(folderId === undefined ? {} : { folderId })
})

// 顧客 ─┬─ A社 ── 案件X
//       └─ B社
// 定例
const folders = [
  folder('customers', '顧客'),
  folder('a', 'A社', 'customers'),
  folder('x', '案件X', 'a'),
  folder('b', 'B社', 'customers'),
  folder('weekly', '定例')
]
const recordings = [
  recording('r-root'),
  recording('r-customers', 'customers'),
  recording('r-a', 'a'),
  recording('r-x', 'x'),
  recording('r-weekly', 'weekly')
]

/**
 * ライブラリはフォルダを上に並べて選び、下にその中身を出す。ボタンの列だけでは
 * 親子を表せないので、選んだフォルダに子があれば、その子の列を 1 段ずつ足していく。
 */
describe('folderChipRows', () => {
  it('1 段目は「すべて」「未分類」と最上位のフォルダ', () => {
    const rows = folderChipRows(folders, recordings, 'all')

    expect(rows.map((row) => row.map((chip) => chip.key))).toEqual([['all', 'unfiled', 'customers', 'weekly']])
  })

  it('選んだフォルダに子があれば、その子を次の段に出す', () => {
    const rows = folderChipRows(folders, recordings, 'customers')

    expect(rows.map((row) => row.map((chip) => chip.key))).toEqual([
      ['all', 'unfiled', 'customers', 'weekly'],
      ['a', 'b']
    ])
  })

  it('深いフォルダを選んだら、祖先から順に段を積む（どこにいるか分かるように）', () => {
    const rows = folderChipRows(folders, recordings, 'x')

    expect(rows.map((row) => row.map((chip) => chip.key))).toEqual([
      ['all', 'unfiled', 'customers', 'weekly'],
      ['a', 'b'],
      ['x']
    ])
    // 経路上のフォルダは選択中として見せる。
    expect(
      rows
        .flat()
        .filter((chip) => chip.onPath)
        .map((chip) => chip.key)
    ).toEqual(['customers', 'a', 'x'])
  })

  it('件数は子フォルダの中の録音も数える', () => {
    const [top] = folderChipRows(folders, recordings, 'all')

    expect(Object.fromEntries((top ?? []).map((chip) => [chip.key, chip.count]))).toEqual({
      all: 5,
      unfiled: 1,
      customers: 3,
      weekly: 1
    })
  })
})

describe('recordingsInFolder', () => {
  it('「すべて」は全件', () => {
    expect(recordingsInFolder(folders, recordings, 'all')).toHaveLength(5)
  })

  it('「未分類」はどのフォルダにも入っていない録音', () => {
    expect(recordingsInFolder(folders, recordings, 'unfiled').map((r) => r.id)).toEqual(['r-root'])
  })

  it('フォルダを選んだら、子フォルダの中の録音も含める', () => {
    expect(recordingsInFolder(folders, recordings, 'customers').map((r) => r.id)).toEqual(['r-customers', 'r-a', 'r-x'])
  })

  it('消えたフォルダの録音は「未分類」に出す（見えなくならないように）', () => {
    const orphan = [recording('r-lost', 'deleted')]

    expect(recordingsInFolder(folders, orphan, 'unfiled').map((r) => r.id)).toEqual(['r-lost'])
  })
})

describe('resolveFolderKey', () => {
  it('選んでいたフォルダが消えたら「すべて」に戻す', () => {
    expect(resolveFolderKey(folders, 'deleted')).toBe('all')
  })

  it('あるフォルダと疑似フォルダはそのまま', () => {
    expect(resolveFolderKey(folders, 'x')).toBe('x')
    expect(resolveFolderKey(folders, 'unfiled')).toBe('unfiled')
  })
})

describe('folderPathLabel', () => {
  it('検索結果の行に添える、フォルダの位置', () => {
    expect(folderPathLabel(folders, 'x')).toBe('顧客 / A社 / 案件X')
  })

  it('フォルダに入っていなければ「未分類」', () => {
    expect(folderPathLabel(folders, undefined)).toBe('未分類')
    expect(folderPathLabel(folders, 'deleted')).toBe('未分類')
  })
})

describe('folderNameLookup', () => {
  it('一覧の行に添える、直属のフォルダ名（親は辿らない）', () => {
    const nameOf = folderNameLookup(folders)

    expect(nameOf('x')).toBe('案件X')
    expect(nameOf('customers')).toBe('顧客')
  })

  it('フォルダに入っていない・消えたフォルダを指すなら何も出さない', () => {
    const nameOf = folderNameLookup(folders)

    expect(nameOf(undefined)).toBeUndefined()
    expect(nameOf('deleted')).toBeUndefined()
  })
})

describe('filterByQuery', () => {
  it('タイトルと要約の冒頭を、大文字小文字を区別せずに探す', () => {
    const items = [
      recording('1', undefined, 'Kickoff'),
      { ...recording('2'), summaryPreview: 'kickoff の段取り' },
      recording('3', undefined, '定例')
    ]

    expect(filterByQuery(items, 'KICKOFF').map((r) => r.id)).toEqual(['1', '2'])
  })

  it('空の検索語なら全件', () => {
    expect(filterByQuery(recordings, '  ')).toHaveLength(5)
  })
})

/**
 * フォルダのボタンが何のドロップを受けるか。「すべて」は最上位（どのフォルダの子でもない）、
 * 「未分類」はどのフォルダにも入っていない、という意味に揃える。受けないボタンでは
 * 強調も出さず、落とせる場所をドラッグ中に見分けられるようにする。
 */
describe('acceptedDrop', () => {
  it('「すべて」はフォルダを受ける（最上位へ出す）が、録音は受けない', () => {
    expect(acceptedDrop('all', [FOLDER_MIME])).toBe('folder')
    // 全件を含む「すべて」へ移しても、何も変わらないように見えてしまう。
    expect(acceptedDrop('all', [RECORDING_MIME])).toBeUndefined()
  })

  it('「未分類」は録音を受ける（フォルダから外す）が、フォルダは受けない', () => {
    expect(acceptedDrop('unfiled', [RECORDING_MIME])).toBe('recording')
    expect(acceptedDrop('unfiled', [FOLDER_MIME])).toBeUndefined()
  })

  it('フォルダは録音もフォルダも受ける', () => {
    expect(acceptedDrop('folder', [RECORDING_MIME])).toBe('recording')
    expect(acceptedDrop('folder', [FOLDER_MIME])).toBe('folder')
  })

  it('アプリの外から来たもの（ファイルなど）は受けない', () => {
    expect(acceptedDrop('folder', ['Files'])).toBeUndefined()
  })
})

describe('英語表示', () => {
  afterEach(() => setLocale('ja'))

  it('「すべて」「未分類」を英語で出す', () => {
    setLocale('en')
    const rows = folderChipRows(folders, recordings, 'all')

    expect(rows[0]?.map((chip) => chip.name)).toEqual(['All Recordings', 'Unfiled', '顧客', '定例'])
  })

  it('フォルダの位置を英語でも「/」で区切る（フォルダ名自体は変わらない）', () => {
    setLocale('en')
    expect(folderPathLabel(folders, 'x')).toBe('顧客 / A社 / 案件X')
    expect(folderPathLabel(folders, undefined)).toBe('Unfiled')
  })
})
