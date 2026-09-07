import { describe, expect, it } from 'vitest'
import { autoExpandedKeys, buildLibraryTree } from '@renderer/library/tree'
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

describe('autoExpandedKeys', () => {
  const folders: FolderDto[] = [
    { id: 'f1', name: '案件X' },
    { id: 'f2', name: '定例', parentId: 'f1' },
    { id: 'f3', name: '別件' }
  ]
  const recordings: RecordingDto[] = [rec('a', { folderId: 'f2' }), rec('b')]

  it('検索中は、部分木に録音を含むノードだけを開く', () => {
    const tree = buildLibraryTree(folders, recordings, 'a')

    expect(autoExpandedKeys(tree, { query: 'a' })).toEqual(new Set(['all', 'f1', 'f2']))
  })

  it('選択中の録音を含むノードとその祖先を開く', () => {
    const tree = buildLibraryTree(folders, recordings, '')

    expect(autoExpandedKeys(tree, { query: '', selectedId: 'a' })).toEqual(
      new Set(['all', 'f1', 'f2'])
    )
  })

  it('検索も選択もなければ何も開かない', () => {
    const tree = buildLibraryTree(folders, recordings, '')

    expect(autoExpandedKeys(tree, { query: '' })).toEqual(new Set())
  })
})
