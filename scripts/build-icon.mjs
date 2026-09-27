/**
 * アプリアイコン（build/icon.icns）とメニューバーのアイコンを生成する。
 *
 * 意匠は「二本の軌跡」— 中心線の上下に波形を分けて置き、上＝相手（システム音声）、
 * 下＝自分（マイク）を表す。2 トラックのまま録るという設計の核をそのまま形にしている。
 *
 * 画像処理の依存を増やさないため、角丸矩形の符号付き距離から被覆率を出して
 * 自前でラスタライズし、PNG も自前で組み立てている。同じ寸法の定義から
 * アプリアイコンとメニューバーのアイコンの両方を出すので、意匠がずれない。
 *
 * メニューバー側は 32x32 のテンプレート画像（RGB は黒、アルファだけで形を作る）。
 * OS がライト／ダークに合わせて塗るため色は乗せられず、上下の非対称な形だけが
 * 2 トラックを運ぶ。整数画素に合わせて描き、16pt @2x で滲まないようにする。
 * 録音中だけは同じ形を赤で塗った色付きの画像に切り替え、待機中と見分けられるようにする
 * （赤はライト／ダークどちらのメニューバーでも読めるので、背景ごとの塗り分けは要らない）。
 */
import { deflateSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const BACKGROUND = [0x1f, 0x29, 0x33]
const REMOTE = [0xf1, 0xef, 0xe8]
const SELF = [0x2f, 0xbf, 0x91]

// 1024 を基準にした意匠の定義。小さいサイズでは棒が潰れるため本数を減らす。
const FULL = {
  bars: 6,
  width: 52,
  gap: 30,
  up: [150, 232, 109, 273, 177, 95],
  down: [123, 191, 259, 136, 218, 82]
}

const SIMPLE = {
  bars: 4,
  width: 76,
  gap: 56,
  up: [180, 273, 120, 232],
  down: [232, 136, 259, 150]
}

const AXIS_GAP = 12

// 録音中のメニューバーのアイコンの色。macOS の systemRed（画面収録などの録音表示と揃える）。
const RECORDING = [0xff, 0x3b, 0x30]

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

const crc32 = (buffer) => {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** RGBA の生データを PNG にする。 */
const encodePng = (size, rgba) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(6, 9)

  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y += 1) {
    raw[y * (1 + size * 4)] = 0
    rgba.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** 角丸矩形の内側なら 1、外側なら 0、境界では中間を返す（1 画素幅で滑らかにする）。 */
const coverage = (px, py, x, y, w, h, radius) => {
  const halfW = w / 2
  const halfH = h / 2
  const dx = Math.abs(px - (x + halfW)) - (halfW - radius)
  const dy = Math.abs(py - (y + halfH)) - (halfH - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  const inside = Math.min(Math.max(dx, dy), 0)
  return Math.min(Math.max(0.5 - (outside + inside - radius), 0), 1)
}

const blend = (rgba, index, color, alpha) => {
  const existing = rgba[index + 3] / 255
  const result = alpha + existing * (1 - alpha)
  if (result === 0) return

  for (let c = 0; c < 3; c += 1) {
    const source = color[c] * alpha
    const dest = rgba[index + c] * existing * (1 - alpha)
    rgba[index + c] = Math.round((source + dest) / result)
  }
  rgba[index + 3] = Math.round(result * 255)
}

const fill = (rgba, size, shape, color) => {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = coverage(x + 0.5, y + 0.5, ...shape)
      if (alpha > 0) blend(rgba, (y * size + x) * 4, color, alpha)
    }
  }
}

/** 意匠の寸法を 1024 基準から指定サイズへ写す。 */
const layout = (size) => {
  const spec = size <= 64 ? SIMPLE : FULL
  const scale = size / 1024
  const span = spec.bars * spec.width + (spec.bars - 1) * spec.gap
  const left = (1024 - span) / 2

  return spec.up.map((upHeight, index) => {
    const x = (left + index * (spec.width + spec.gap)) * scale
    const width = spec.width * scale
    const radius = width / 2
    const downHeight = spec.down[index]

    return {
      up: [x, (512 - AXIS_GAP - upHeight) * scale, width, upHeight * scale, radius],
      down: [x, (512 + AXIS_GAP) * scale, width, downHeight * scale, radius]
    }
  })
}

const appIcon = (size) => {
  const rgba = Buffer.alloc(size * size * 4)
  fill(rgba, size, [0, 0, size, size, size * 0.2237], BACKGROUND)

  for (const bar of layout(size)) {
    fill(rgba, size, bar.up, REMOTE)
    fill(rgba, size, bar.down, SELF)
  }

  return encodePng(size, rgba)
}

/**
 * メニューバー用の 32x32。整数画素に合わせて描く。
 * 棒は幅 3・間隔 2 の 6 本、中心に 2 行の溝を空けて上下を分ける。
 * 待機中はテンプレート画像にするので黒、録音中は赤で塗る。
 */
const trayIcon = (color) => {
  const size = 32
  const rgba = Buffer.alloc(size * size * 4)
  const up = [7, 11, 5, 13, 8, 4]
  const down = [6, 9, 12, 6, 10, 4]

  const paint = (x, y) => {
    const index = (y * size + x) * 4
    rgba[index] = color[0]
    rgba[index + 1] = color[1]
    rgba[index + 2] = color[2]
    rgba[index + 3] = 255
  }

  up.forEach((upHeight, index) => {
    const left = 2 + index * 5
    for (let x = left; x < left + 3; x += 1) {
      for (let y = 15 - upHeight; y <= 14; y += 1) paint(x, y)
      for (let y = 17; y <= 16 + down[index]; y += 1) paint(x, y)
    }
  })

  return encodePng(size, rgba)
}

const iconset = join(root, 'build/icon.iconset')
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })

for (const [name, size] of [
  ['icon_16x16', 16],
  ['icon_16x16@2x', 32],
  ['icon_32x32', 32],
  ['icon_32x32@2x', 64],
  ['icon_128x128', 128],
  ['icon_128x128@2x', 256],
  ['icon_256x256', 256],
  ['icon_256x256@2x', 512],
  ['icon_512x512', 512],
  ['icon_512x512@2x', 1024]
]) {
  writeFileSync(join(iconset, `${name}.png`), appIcon(size))
}

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')])
rmSync(iconset, { recursive: true, force: true })

writeFileSync(join(root, 'build/icon.png'), appIcon(1024))
process.stdout.write(`idle:      ${trayIcon([0, 0, 0]).toString('base64')}\n`)
process.stdout.write(`recording: ${trayIcon(RECORDING).toString('base64')}\n`)
