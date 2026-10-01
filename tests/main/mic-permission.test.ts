import { describe, expect, it, vi } from 'vitest'
import { requestMicPermission } from '../../src/main/micPermission'

const preferences = (status: string) => ({
  getMediaAccessStatus: vi.fn(() => status),
  askForMediaAccess: vi.fn(async () => true)
})

describe('requestMicPermission', () => {
  it('macOS では OS の許可ダイアログを出し、その結果を返す', async () => {
    const prefs = preferences('not-determined')

    await expect(requestMicPermission(prefs, 'darwin')).resolves.toBe(true)
    expect(prefs.askForMediaAccess).toHaveBeenCalledWith('microphone')
  })

  it('Windows ではダイアログを出せないので、今の状態が許可済みかを返す', async () => {
    const granted = preferences('granted')
    const denied = preferences('denied')

    await expect(requestMicPermission(granted, 'win32')).resolves.toBe(true)
    await expect(requestMicPermission(denied, 'win32')).resolves.toBe(false)
    expect(granted.askForMediaAccess).not.toHaveBeenCalled()
  })
})
