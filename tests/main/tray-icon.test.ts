import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  TRAY_ICON_PNG_BASE64,
  TRAY_ICON_RECORDING_PNG_BASE64,
  trayIconFor,
  whitenBitmap
} from '../../src/main/trayIcon'

/**
 * メニューバーのアイコンが実際に描画できる PNG であることを確かめる。
 *
 * かつて手で作った base64 を埋め込んでいたが、ヘッダだけ正しく IDAT が壊れており、
 * Electron 側では空の画像（0x0）になっていた。見た目で気づきにくく、
 * 「メニューバーに何も出ない」という形でしか現れなかったため、ここで固定する。
 */
interface Chunk {
  readonly type: string
  readonly data: Buffer
}

const chunks = (png: Buffer): Chunk[] => {
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

const header = (png: Buffer): { width: number; height: number; colorType: number } => {
  const ihdr = chunks(png).find((chunk) => chunk.type === 'IHDR')
  if (!ihdr) throw new Error('IHDR がありません。')

  return {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    colorType: ihdr.data.readUInt8(9)
  }
}

const pixels = (png: Buffer): Buffer => {
  const idat = chunks(png).filter((chunk) => chunk.type === 'IDAT')
  expect(idat.length).toBeGreaterThan(0)
  // 壊れていれば checksum エラーで例外になる
  return inflateSync(Buffer.concat(idat.map((chunk) => chunk.data)))
}

/** 各画素のアルファだけを取り出す。待機中と録音中で形が同じかを比べるため。 */
const alphas = (png: Buffer): number[] => {
  const data = pixels(png)
  const result: number[] = []

  for (let y = 0; y < 32; y += 1) {
    const rowStart = y * (1 + 32 * 4) + 1
    for (let x = 0; x < 32; x += 1) result.push(data[rowStart + x * 4 + 3]!)
  }

  return result
}

const idle = Buffer.from(TRAY_ICON_PNG_BASE64, 'base64')
const recording = Buffer.from(TRAY_ICON_RECORDING_PNG_BASE64, 'base64')

describe.each([
  ['待機中', idle],
  ['録音中', recording]
])('メニューバーのアイコン（%s）', (_, png) => {
  it('PNG の署名を持つ', () => {
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('32x32 の RGBA である（16pt @2x として扱う）', () => {
    expect(header(png)).toEqual({ width: 32, height: 32, colorType: 6 })
  })

  it('画像データが破損しておらず展開できる', () => {
    // 16x16 RGBA + 各行のフィルタバイト
    expect(pixels(png).length).toBe(32 * (1 + 32 * 4))
  })

  it('透明なだけの画像ではない（実際に見える）', () => {
    const data = pixels(png)
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

  /**
   * アプリアイコンと同じ「二本の軌跡」— 中心線の上下に波形を分けて置く形。
   * 単色のテンプレート画像では色で 2 トラックを示せないため、
   * 上下の非対称な形だけが意味を運ぶ。崩すと単なる波形アイコンになる。
   */
  const visibleColumns = (y: number): number[] => {
    const data = pixels(png)
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

/** 1 本目の棒（x=2..4）の一番下の行の画素。 */
const firstBarPixel = (png: Buffer): number[] => {
  const data = pixels(png)
  const offset = 14 * (1 + 32 * 4) + 1 + 3 * 4
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!]
}

describe('待機中と録音中の見分け', () => {
  it('待機中はテンプレート画像として使えるよう RGB を黒にする', () => {
    expect(firstBarPixel(idle)).toEqual([0, 0, 0, 255])
  })

  /**
   * 録音中は色で知らせる。テンプレート画像は OS が単色に塗り直すため、
   * 色を乗せるにはテンプレートを外すしかない。赤はライト／ダークの
   * どちらのメニューバーでも読めるので、背景に合わせた塗り分けは要らない。
   */
  it('録音中は棒を赤（macOS の systemRed）で塗る', () => {
    expect(firstBarPixel(recording)).toEqual([0xff, 0x3b, 0x30, 255])
  })

  // 形まで変わると別のアイコンに見える。色だけを変えて同じアプリだと分かるようにする。
  it('録音中も形は待機中と同じ', () => {
    expect(alphas(recording)).toEqual(alphas(idle))
  })

  it('macOS の待機中はテンプレート画像（OS が明暗に合わせて塗る）、録音中は色付きの画像を使う', () => {
    const macos = { platform: 'macos', darkTaskbar: false } as const
    expect(trayIconFor(false, macos)).toEqual({ pngBase64: TRAY_ICON_PNG_BASE64, template: true, whiten: false })
    expect(trayIconFor(true, macos)).toEqual({
      pngBase64: TRAY_ICON_RECORDING_PNG_BASE64,
      template: false,
      whiten: false
    })
  })
})

/**
 * Windows はテンプレート画像を塗り直さないので、黒いままだとダークのタスクバーで見えない。
 * タスクバーの明暗に合わせて、待機中だけ白く塗る。
 */
describe('Windows のトレイのアイコン', () => {
  it('ダークのタスクバーでは待機中のアイコンを白くする', () => {
    expect(trayIconFor(false, { platform: 'windows', darkTaskbar: true })).toEqual({
      pngBase64: TRAY_ICON_PNG_BASE64,
      template: false,
      whiten: true
    })
  })

  it('ライトのタスクバーでは黒のまま見せる', () => {
    expect(trayIconFor(false, { platform: 'windows', darkTaskbar: false })).toEqual({
      pngBase64: TRAY_ICON_PNG_BASE64,
      template: false,
      whiten: false
    })
  })

  it('録音中は明暗によらず赤のまま', () => {
    expect(trayIconFor(true, { platform: 'windows', darkTaskbar: true })).toEqual({
      pngBase64: TRAY_ICON_RECORDING_PNG_BASE64,
      template: false,
      whiten: false
    })
  })

  it('白くするときは形（透明度）を変えず、色だけを透明度に合わせて塗る', () => {
    // BGRA の 3 画素: 不透明の黒・半透明の黒・透明。乗算済みの画素でも壊れないよう、色は透明度と同じ値にする。
    const bitmap = Buffer.from([0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 0])

    expect([...whitenBitmap(bitmap)]).toEqual([255, 255, 255, 255, 128, 128, 128, 128, 0, 0, 0, 0])
  })
})
