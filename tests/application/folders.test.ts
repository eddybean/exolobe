import { beforeEach, describe, expect, it } from 'vitest'
import {
  CreateFolder,
  DeleteFolder,
  ListFolders,
  MoveFolder,
  MoveRecordingToFolder,
  RenameFolder
} from '@application/usecases/folders'
import { createRecording } from '@domain/Recording'
import { FakeFolderRepository, FakeIdGenerator, FakeRecordingRepository } from './fakes'

const startedAt = new Date('2026-09-06T14:30:00+09:00')

let folders: FakeFolderRepository
let recordings: FakeRecordingRepository
let ids: FakeIdGenerator
let deps: {
  folders: FakeFolderRepository
  recordings: FakeRecordingRepository
  ids: FakeIdGenerator
}

beforeEach(() => {
  folders = new FakeFolderRepository()
  recordings = new FakeRecordingRepository()
  ids = new FakeIdGenerator()
  deps = { folders, recordings, ids }
})

describe('ListFolders', () => {
  it('保存されているフォルダを返す', async () => {
    await folders.replaceAll([{ id: 'f1', name: '議事録' }])

    expect(await new ListFolders(deps).execute()).toEqual([{ id: 'f1', name: '議事録' }])
  })
})

describe('CreateFolder', () => {
  it('トップレベルのフォルダを作る', async () => {
    const folder = await new CreateFolder(deps).execute({ name: '議事録' })

    expect(folder).toEqual({ id: 'rec-1', name: '議事録' })
    expect(await folders.list()).toEqual([folder])
  })

  it('親フォルダを指定して子フォルダを作る', async () => {
    await folders.replaceAll([{ id: 'parent', name: '親' }])

    const folder = await new CreateFolder(deps).execute({ name: '子', parentId: 'parent' })

    expect(folder).toEqual({ id: 'rec-1', name: '子', parentId: 'parent' })
  })

  it('存在しない親フォルダは指定できない', async () => {
    await expect(
      new CreateFolder(deps).execute({ name: '子', parentId: 'unknown' })
    ).rejects.toThrow('親フォルダが見つかりません。')
  })

  it('空の名前は拒否する', async () => {
    await expect(new CreateFolder(deps).execute({ name: '  ' })).rejects.toThrow(
      'フォルダ名を入力してください。'
    )
  })
})

describe('RenameFolder', () => {
  it('名前だけを変える', async () => {
    await folders.replaceAll([{ id: 'f1', name: '旧名' }])

    const renamed = await new RenameFolder(deps).execute({ folderId: 'f1', name: '新名' })

    expect(renamed).toEqual({ id: 'f1', name: '新名' })
  })

  it('存在しないフォルダは変更できない', async () => {
    await expect(
      new RenameFolder(deps).execute({ folderId: 'unknown', name: '新名' })
    ).rejects.toThrow('フォルダが見つかりません。')
  })
})

describe('MoveFolder', () => {
  beforeEach(async () => {
    await folders.replaceAll([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'b' }
    ])
  })

  it('親を変更する', async () => {
    await new MoveFolder(deps).execute({ folderId: 'c', parentId: 'a' })

    expect((await folders.list()).find((f) => f.id === 'c')).toEqual({
      id: 'c',
      name: 'C',
      parentId: 'a'
    })
  })

  it('親の指定を外してトップレベルに戻せる', async () => {
    await new MoveFolder(deps).execute({ folderId: 'b', parentId: undefined })

    expect((await folders.list()).find((f) => f.id === 'b')).toEqual({ id: 'b', name: 'B' })
  })

  it('自分自身を親にはできない', async () => {
    await expect(new MoveFolder(deps).execute({ folderId: 'a', parentId: 'a' })).rejects.toThrow(
      '自分自身や子孫フォルダの下には移動できません。'
    )
  })

  it('自分の子孫を親にはできない（循環防止）', async () => {
    await expect(new MoveFolder(deps).execute({ folderId: 'a', parentId: 'c' })).rejects.toThrow(
      '自分自身や子孫フォルダの下には移動できません。'
    )
  })
})

describe('DeleteFolder', () => {
  beforeEach(async () => {
    await folders.replaceAll([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'b' }
    ])
    await recordings.save({
      ...createRecording({ id: 'rec-x', startedAt }),
      folderId: 'b'
    })
  })

  it('子フォルダを親フォルダへ退避してから削除する', async () => {
    await new DeleteFolder(deps).execute({ folderId: 'b' })

    const remaining = await folders.list()
    expect(remaining.map((f) => f.id)).toEqual(['a', 'c'])
    expect(remaining.find((f) => f.id === 'c')).toEqual({ id: 'c', name: 'C', parentId: 'a' })
  })

  it('トップレベルのフォルダを削除すると子は未分類（トップレベル）へ退避する', async () => {
    await new DeleteFolder(deps).execute({ folderId: 'a' })

    const remaining = await folders.list()
    expect(remaining.map((f) => f.id)).toEqual(['b', 'c'])
    expect(remaining.find((f) => f.id === 'b')).toEqual({ id: 'b', name: 'B' })
    expect(remaining.find((f) => f.id === 'c')).toEqual({ id: 'c', name: 'C', parentId: 'b' })
  })

  it('中身の録音は親フォルダへ退避する', async () => {
    await new DeleteFolder(deps).execute({ folderId: 'b' })

    expect((await recordings.find('rec-x'))?.folderId).toBe('a')
  })

  it('存在しないフォルダは削除できない', async () => {
    await expect(new DeleteFolder(deps).execute({ folderId: 'unknown' })).rejects.toThrow(
      'フォルダが見つかりません。'
    )
  })
})

describe('MoveRecordingToFolder', () => {
  beforeEach(async () => {
    await folders.replaceAll([{ id: 'f1', name: '議事録' }])
    await recordings.save(createRecording({ id: 'rec-x', startedAt }))
  })

  it('録音をフォルダへ割り当てる', async () => {
    const recording = await new MoveRecordingToFolder(deps).execute({
      recordingId: 'rec-x',
      folderId: 'f1'
    })

    expect(recording.folderId).toBe('f1')
    expect((await recordings.find('rec-x'))?.folderId).toBe('f1')
  })

  it('folderId を省略すると未分類に戻す', async () => {
    await recordings.save({ ...createRecording({ id: 'rec-x', startedAt }), folderId: 'f1' })

    const recording = await new MoveRecordingToFolder(deps).execute({
      recordingId: 'rec-x',
      folderId: undefined
    })

    expect(recording.folderId).toBeUndefined()
  })

  it('存在しないフォルダへは割り当てられない', async () => {
    await expect(
      new MoveRecordingToFolder(deps).execute({ recordingId: 'rec-x', folderId: 'unknown' })
    ).rejects.toThrow('フォルダが見つかりません。')
  })

  it('存在しない録音は割り当てられない', async () => {
    await expect(
      new MoveRecordingToFolder(deps).execute({ recordingId: 'unknown', folderId: 'f1' })
    ).rejects.toThrow('録音が見つかりません: unknown')
  })
})
