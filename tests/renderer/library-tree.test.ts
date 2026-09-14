import { describe, expect, it } from 'vitest'
import {
  buildLibraryTree,
  resolveOpen,
  searchExpandedKeys,
  type LibraryNode
} from '@renderer/library/tree'
import type { FolderDto, RecordingDto } from '@shared/ipc'

const STEPS = ['mix', 'transcribe', 'diarize', 'summarize', 'encode'] as const

const rec = (id: string, overrides: Partial<RecordingDto> = {}): RecordingDto => ({
  id,
  title: id,
  startedAt: '2026-09-07T10:00:00.000Z',
  durationMs: 0,
  status: 'ready',
  steps: Object.fromEntries(
    STEPS.map((step) => [step, { status: 'done' }])
  ) as RecordingDto['steps'],
  slug: id,
  ...overrides
})

/** ノードの構造だけを見たいときの縮約表現。 */
const shape = (
  nodes: readonly { key: string; recordings: readonly RecordingDto[]; children: readonly unknown[] }[]
): unknown =>
  nodes.map((node) => ({
    key: node.key,
    recordings: node.recordings.map((recording) => recording.id),
    children: shape(node.children as never)
  }))

describe('buildLibraryTree', () => {
  const folders: FolderDto[] = [
    { id: 'f1', name: '案件X' },
    { id: 'f2', name: '定例', parentId: 'f1' }
  ]
  const recordings: RecordingDto[] = [
    rec('a', { folderId: 'f1' }),
    rec('b'),
    rec('c', { folderId: 'f2' })
  ]

  it('「すべて」「未分類」に続いてフォルダが並ぶ', () => {
    expect(buildLibraryTree(folders, recordings, '').map((node) => node.key)).toEqual([
      'all',
      'unfiled',
      'f1'
    ])
  })

  it('「すべて」は全録音、「未分類」は所属なしの録音だけを持つ', () => {
    const [all, unfiled] = buildLibraryTree(folders, recordings, '')

    expect(all?.recordings.map((recording) => recording.id)).toEqual(['a', 'b', 'c'])
    expect(unfiled?.recordings.map((recording) => recording.id)).toEqual(['b'])
  })

  it('フォルダは親子にネストし、録音は所属フォルダの直下に入る', () => {
    const tree = buildLibraryTree(folders, recordings, '')

    expect(shape(tree.slice(2))).toEqual([
      {
        key: 'f1',
        recordings: ['a'],
        children: [{ key: 'f2', recordings: ['c'], children: [] }]
      }
    ])
  })

  it('ドロップ先を区別できるよう種別を持つ', () => {
    expect(buildLibraryTree(folders, recordings, '').map((node) => node.kind)).toEqual([
      'all',
      'unfiled',
      'folder'
    ])
  })

  it('親が消えたフォルダは根として扱う', () => {
    const orphan: FolderDto[] = [{ id: 'f9', name: '孤児', parentId: 'missing' }]

    expect(buildLibraryTree(orphan, [], '').map((node) => node.key)).toEqual([
      'all',
      'unfiled',
      'f9'
    ])
  })

  it('検索語はタイトルと要約プレビューに大文字小文字を無視して当てる', () => {
    const items = [
      rec('a', { title: 'Kickoff 会議' }),
      rec('b', { title: '定例', summaryPreview: 'KICKOFF の振り返り' }),
      rec('c', { title: '雑談' })
    ]
    const [all] = buildLibraryTree([], items, 'kickoff')

    expect(all?.recordings.map((recording) => recording.id)).toEqual(['a', 'b'])
  })

  it('検索してもフォルダ自体は消さず、録音だけを絞る', () => {
    const tree = buildLibraryTree(folders, recordings, 'c')

    expect(tree.map((node) => node.key)).toEqual(['all', 'unfiled', 'f1'])
    expect(tree[2]?.recordings).toEqual([])
    expect(tree[2]?.children[0]?.recordings.map((recording) => recording.id)).toEqual(['c'])
  })
})

describe('searchExpandedKeys', () => {
  const folders: FolderDto[] = [
    { id: 'f1', name: '案件X' },
    { id: 'f2', name: '定例', parentId: 'f1' },
    { id: 'f3', name: '別件' }
  ]
  const recordings: RecordingDto[] = [rec('a', { folderId: 'f2' }), rec('b')]

  it('部分木に録音を含むノードだけを開く', () => {
    const tree = buildLibraryTree(folders, recordings, 'a')

    expect(searchExpandedKeys(tree)).toEqual(new Set(['all', 'f1', 'f2']))
  })

  it('当たりが無ければ何も開かない', () => {
    const tree = buildLibraryTree(folders, recordings, 'zzz')

    expect(searchExpandedKeys(tree)).toEqual(new Set())
  })
})

describe('resolveOpen', () => {
  const folders: FolderDto[] = [{ id: 'f1', name: '案件X' }]
  const recordings: RecordingDto[] = [rec('a', { folderId: 'f1' })]
  const tree = buildLibraryTree(folders, recordings, '')
  const [all, , f1] = tree
  const none = new Map<string, boolean>()

  const open = (
    node: LibraryNode,
    params: Partial<Parameters<typeof resolveOpen>[1]> = {}
  ): boolean =>
    resolveOpen(node, {
      toggled: none,
      searchToggled: none,
      searchExpanded: new Set<string>(),
      searching: false,
      ...params
    })

  it('既定では「すべて」だけが開き、フォルダは閉じている', () => {
    expect(open(all as LibraryNode)).toBe(true)
    expect(open(f1 as LibraryNode)).toBe(false)
  })

  it('ユーザーが閉じた「すべて」は閉じたままになる', () => {
    expect(open(all as LibraryNode, { toggled: new Map([['all', false]]) })).toBe(false)
  })

  it('検索中は当たりを含むノードを開く', () => {
    expect(
      open(f1 as LibraryNode, { searching: true, searchExpanded: new Set(['f1']) })
    ).toBe(true)
  })

  it('検索中はユーザーが手で決めた開閉に影響されない', () => {
    expect(
      open(all as LibraryNode, {
        searching: true,
        searchExpanded: new Set(['all']),
        toggled: new Map([['all', false]])
      })
    ).toBe(true)
  })

  it('検索中の開閉操作は検索中だけ効く', () => {
    const searchToggled = new Map([['all', false]])

    expect(
      open(all as LibraryNode, { searching: true, searchExpanded: new Set(['all']), searchToggled })
    ).toBe(false)
    // 検索を抜ければ、手で決めた開閉に戻る。
    expect(open(all as LibraryNode, { searchToggled })).toBe(true)
  })
})
