/**
 * 台本から評価用の音声と正解（いつ何を言ったか）を組み立てる。
 *
 * 読み上げ（say）は外から渡す。ここを純粋に保つと、正解の時刻の計算をテストでき、
 * 音声の生成を macOS に縛られずに確かめられる。
 */

/** whisper が前提とする 16kHz。 */
export const SAMPLE_RATE = 16_000

/**
 * 雑音の種類。VAD や whisper の引っかかり方が種類ごとに違う。
 * - fan: 空調やファンのような低い連続音
 * - keyboard: 打鍵のような短い衝撃音
 * - hum: 電源の 50Hz のうなり
 * - music: 和音が移り変わる BGM（whisper は音楽に字幕の定型句を付けやすい）
 */
export type NoiseType = 'fan' | 'keyboard' | 'hum' | 'music'

export interface Noise {
  readonly type: NoiseType
  /** 振幅の目安（0〜1）。 */
  readonly level: number
}

export interface Voice {
  readonly text: string
  /** `say -v` に渡す声の名前。 */
  readonly voice: string
}

export type ScenarioPart =
  | (Voice & { readonly kind: 'speech'; readonly gain?: number; readonly noise?: Noise })
  | { readonly kind: 'gap'; readonly seconds: number; readonly noise: Noise }
  | {
      readonly kind: 'overlap'
      readonly main: Voice
      /** 主の声の下に小さく敷く声。主の開始から `delaySeconds` 遅れて始まる。 */
      readonly under: Voice & { readonly gain: number; readonly delaySeconds: number }
      readonly noise?: Noise
    }

export interface Utterance {
  readonly startMs: number
  readonly endMs: number
  readonly text: string
}

/** 読み上げた音を返す関数。-1〜1 のサンプル列。 */
export type Speak = (text: string, voice: string) => Float32Array

/** 乱数の種を固定した生成器（mulberry32）。同じ台本から同じ雑音を作るため。 */
const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const CHORDS = [
  [261.63, 329.63, 392.0],
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [196.0, 246.94, 293.66]
] as const

const generateNoise = (noise: Noise, length: number, random: () => number): Float32Array => {
  const out = new Float32Array(length)
  switch (noise.type) {
    case 'fan': {
      // 白色雑音を 1 次のローパスで丸める。丸めた分だけ振幅が落ちるので戻す。
      let previous = 0
      for (let i = 0; i < length; i++) {
        previous = 0.9 * previous + 0.1 * (random() * 2 - 1)
        out[i] = previous * noise.level * 3
      }
      break
    }
    case 'keyboard': {
      // 0.1〜0.4 秒おきに、15ms で減衰する破裂音。
      let next = Math.floor(random() * 0.3 * SAMPLE_RATE)
      while (next < length) {
        const burst = Math.floor(0.015 * SAMPLE_RATE)
        for (let i = 0; i < burst && next + i < length; i++) {
          out[next + i] = (random() * 2 - 1) * noise.level * (1 - i / burst)
        }
        next += Math.floor((0.1 + random() * 0.3) * SAMPLE_RATE)
      }
      break
    }
    case 'hum': {
      for (let i = 0; i < length; i++) {
        const t = i / SAMPLE_RATE
        out[i] =
          noise.level *
          (0.7 * Math.sin(2 * Math.PI * 50 * t) + 0.3 * Math.sin(2 * Math.PI * 150 * t))
      }
      break
    }
    case 'music': {
      // 2 秒ごとに和音を替える。和音の中の音はそれぞれ同じ強さ。
      for (let i = 0; i < length; i++) {
        const t = i / SAMPLE_RATE
        const chord = CHORDS[Math.floor(t / 2) % CHORDS.length] ?? CHORDS[0]
        const tone = chord.reduce((sum, freq) => sum + Math.sin(2 * Math.PI * freq * t), 0)
        out[i] = (noise.level * tone) / chord.length
      }
      break
    }
  }
  return out
}

const addInto = (target: Float32Array, source: Float32Array, offset: number, gain = 1): void => {
  for (let i = 0; i < source.length && offset + i < target.length; i++) {
    target[offset + i] = (target[offset + i] ?? 0) + (source[i] ?? 0) * gain
  }
}

const toMs = (sampleIndex: number): number => Math.round((sampleIndex / SAMPLE_RATE) * 1000)

/** 台本を音声と正解に組み立てる。雑音の乱数の種は固定。 */
export const composeScenario = (
  parts: readonly ScenarioPart[],
  speak: Speak
): { samples: Float32Array; said: Utterance[] } => {
  const random = seededRandom(42)
  const blocks: Float32Array[] = []
  const said: Utterance[] = []
  let cursor = 0

  const place = (block: Float32Array, noise: Noise | undefined): void => {
    if (noise) addInto(block, generateNoise(noise, block.length, random), 0)
    blocks.push(block)
    cursor += block.length
  }

  for (const part of parts) {
    switch (part.kind) {
      case 'speech': {
        const voice = speak(part.text, part.voice)
        const block = new Float32Array(voice.length)
        addInto(block, voice, 0, part.gain ?? 1)
        said.push({ startMs: toMs(cursor), endMs: toMs(cursor + voice.length), text: part.text })
        place(block, part.noise)
        break
      }
      case 'gap':
        place(new Float32Array(Math.round(part.seconds * SAMPLE_RATE)), part.noise)
        break
      case 'overlap': {
        const main = speak(part.main.text, part.main.voice)
        const under = speak(part.under.text, part.under.voice)
        const delay = Math.round(part.under.delaySeconds * SAMPLE_RATE)
        const block = new Float32Array(Math.max(main.length, delay + under.length))
        addInto(block, main, 0)
        addInto(block, under, delay, part.under.gain)
        said.push(
          { startMs: toMs(cursor), endMs: toMs(cursor + main.length), text: part.main.text },
          {
            startMs: toMs(cursor + delay),
            endMs: toMs(cursor + delay + under.length),
            text: part.under.text
          }
        )
        place(block, part.noise)
        break
      }
    }
  }

  const samples = new Float32Array(cursor)
  let offset = 0
  for (const block of blocks) {
    samples.set(block, offset)
    offset += block.length
  }
  return { samples, said }
}
