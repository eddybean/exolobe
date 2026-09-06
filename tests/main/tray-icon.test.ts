import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { TRAY_ICON_PNG_BASE64 } from '../../src/main/trayIcon'

/**
 * メニューバーのアイコンが実際に描画できる PNG であることを確かめる。
 *
 * かつて手で作った base64 を埋め込んでいたが、ヘッダだけ正しく IDAT が壊れており、
 * Electron 側では空の画像（0x0）になっていた。見た目で気づきにくく、
 * 「メニューバーに何も出ない」という形でしか現れなかったため、ここで固定する。
 */
const png = Buffer.from(TRAY_ICON_PNG_BASE64, 'base64')

interface Chunk {
  readonly type: string
  readonly data: Buffer
}

const chunks = (): Chunk[] => {
  const result: Chunk[] = []
  let offset = 8

  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    result.push({ type, data: png.subarray(offset + 8, offset + 8 + length) })
    if (type === 'IEND') break
    offset += 12 + length
  }

  return result
}

const header = (): { width: number; height: number; colorType: number } => {
  const ihdr = chunks().find((chunk) => chunk.type === 'IHDR')
  if (!ihdr) throw new Error('IHDR がありません。')

  return {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    colorType: ihdr.data.readUInt8(9)
  }
}

const pixels = (): Buffer => {
  const idat = chunks().filter((chunk) => chunk.type === 'IDAT')
  expect(idat.length).toBeGreaterThan(0)
  // 壊れていれば checksum エラーで例外になる
  return inflateSync(Buffer.concat(idat.map((chunk) => chunk.data)))
}

describe('メニューバーのアイコン', () => {
  it('PNG の署名を持つ', () => {
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('32x32 の RGBA である（16pt @2x として扱う）', () => {
    expect(header()).toEqual({ width: 32, height: 32, colorType: 6 })
  })

  it('画像データが破損しておらず展開できる', () => {
    // 16x16 RGBA + 各行のフィルタバイト
    expect(pixels().length).toBe(32 * (1 + 32 * 4))
  })

  it('透明なだけの画像ではない（実際に見える）', () => {
    const data = pixels()
    let visible = 0

    for (let y = 0; y < 32; y += 1) {
      const rowStart = y * (1 + 32 * 4) + 1
      for (let x = 0; x < 32; x += 1) {
        if (data[rowStart + x * 4 + 3] !== 0) visible += 1
      }
    }

    // 半径 10.5 の円なので 300 ピクセル前後は不透明になる
    expect(visible).toBeGreaterThan(200)
  })

  it('テンプレート画像として使えるよう RGB は黒にする', () => {
    const data = pixels()
    const rowStart = 16 * (1 + 32 * 4) + 1
    const center = rowStart + 16 * 4

    expect([data[center], data[center + 1], data[center + 2]]).toEqual([0, 0, 0])
    expect(data[center + 3]).toBe(255)
  })
})
