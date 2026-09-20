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

    // 上下の棒の高さの合計 95 行 × 幅 3px
    expect(visible).toBe(285)
  })

  it('テンプレート画像として使えるよう RGB は黒にする', () => {
    const data = pixels()
    // 1 本目の棒（x=2..4）の一番下の行
    const offset = 14 * (1 + 32 * 4) + 1 + 3 * 4

    expect([data[offset], data[offset + 1], data[offset + 2]]).toEqual([0, 0, 0])
    expect(data[offset + 3]).toBe(255)
  })

  /**
   * アプリアイコンと同じ「二本の軌跡」— 中心線の上下に波形を分けて置く形。
   * 単色のテンプレート画像では色で 2 トラックを示せないため、
   * 上下の非対称な形だけが意味を運ぶ。崩すと単なる波形アイコンになる。
   */
  const visibleColumns = (y: number): number[] => {
    const data = pixels()
    const rowStart = y * (1 + 32 * 4) + 1
    const columns: number[] = []

    for (let x = 0; x < 32; x += 1) {
      if (data[rowStart + x * 4 + 3] !== 0) columns.push(x)
    }

    return columns
  }

  it('中心線の上下どちらにも波形がある', () => {
    expect(visibleColumns(14).length).toBeGreaterThan(0)
    expect(visibleColumns(17).length).toBeGreaterThan(0)
  })

  it('中心線には 2 行の溝があり、上下のトラックが分かれている', () => {
    expect(visibleColumns(15)).toEqual([])
    expect(visibleColumns(16)).toEqual([])
  })

  it('溝のすぐ上は棒 6 本に分かれている', () => {
    const runs = visibleColumns(14).reduce(
      (count, x, index, all) => (index === 0 || x !== all[index - 1]! + 1 ? count + 1 : count),
      0
    )

    expect(runs).toBe(6)
  })
})
