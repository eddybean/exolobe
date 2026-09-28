import { describe, expect, it } from 'vitest'
import { createFolder, isDescendant, type Folder } from '@domain/Folder'

describe('createFolder', () => {
  it('id・トリム済みの名前・親IDを持つフォルダを作る', () => {
    const folder = createFolder({ id: 'f1', name: ' 議事録 ', parentId: 'root' })

    expect(folder).toEqual({ id: 'f1', name: '議事録', parentId: 'root' })
  })

  it('親を指定しなければトップレベルのフォルダになる', () => {
    const folder = createFolder({ id: 'f1', name: 'プロジェクトA' })

    expect(folder.parentId).toBeUndefined()
  })

  it('空の名前は許さない', () => {
    expect(() => createFolder({ id: 'f1', name: '   ' })).toThrow('folderNameRequired')
  })
})

describe('isDescendant', () => {
  const folders: Folder[] = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B', parentId: 'a' },
    { id: 'c', name: 'C', parentId: 'b' },
    { id: 'd', name: 'D' }
  ]

  it('直接の子は子孫と判定する', () => {
    expect(isDescendant(folders, 'a', 'b')).toBe(true)
  })

  it('孫も子孫と判定する', () => {
    expect(isDescendant(folders, 'a', 'c')).toBe(true)
  })

  it('無関係なフォルダは子孫ではない', () => {
    expect(isDescendant(folders, 'a', 'd')).toBe(false)
  })

  it('自分自身は子孫ではない', () => {
    expect(isDescendant(folders, 'a', 'a')).toBe(false)
  })
})
