import type { AudioMixerPort } from '@application/ports'
import { AppError } from '@domain/errors'
import { WavFileWriter, clampInt16, durationMsForPcm, int16Buffer, readWav } from './wav'

export class MixError extends AppError {}

/** 一度に書き出す PCM サンプル数。メモリのピークを抑えるためのチャンク単位。 */
const WRITE_CHUNK_SAMPLES = 16_000

/**
 * マイクとシステム音声を 1 本の WAV に合成する。
 *
 * 2 つのトラックは別々のタイミングで録音が始まるため、開始時刻の差
 * （offsetMs）だけ後ろにずらしてから加算する。加算結果は 16bit の範囲へ
 * クリップし、音割れの代わりに歪みを抑える。
 */
export class TrackMixer implements AudioMixerPort {
  async mix(params: {
    tracks: readonly { path: string; offsetMs: number }[]
    outputPath: string
  }): Promise<{ durationMs: number }> {
    if (params.tracks.length === 0) {
      throw new MixError({ code: 'mixNoTracks' })
    }

    const loaded = await Promise.all(
      params.tracks.map(async (track) => {
        const wav = await readWav(track.path)
        return {
          samples: wav.samples,
          sampleRate: wav.sampleRate,
          // 負のオフセットは「先に始まっていた」ことを意味するが、基準トラックより
          // 前に音を置く場所は無いため 0 に丸める。
          offsetSamples: Math.max(0, Math.round((track.offsetMs / 1000) * wav.sampleRate))
        }
      })
    )

    const sampleRate = loaded[0]?.sampleRate
    if (sampleRate === undefined) {
      throw new MixError({ code: 'mixNoTracks' })
    }
    if (loaded.some((track) => track.sampleRate !== sampleRate)) {
      throw new MixError({
        code: 'mixSampleRateMismatch',
        sampleRates: loaded.map((track) => track.sampleRate)
      })
    }

    const totalSamples = loaded.reduce((max, track) => Math.max(max, track.offsetSamples + track.samples.length), 0)

    const writer = await WavFileWriter.create(params.outputPath, { sampleRate })
    try {
      for (let start = 0; start < totalSamples; start += WRITE_CHUNK_SAMPLES) {
        const end = Math.min(start + WRITE_CHUNK_SAMPLES, totalSamples)
        const chunk = new Array<number>(end - start).fill(0)

        for (const track of loaded) {
          for (let index = start; index < end; index += 1) {
            const position = index - track.offsetSamples
            if (position < 0 || position >= track.samples.length) continue
            chunk[index - start] = clampInt16((chunk[index - start] ?? 0) + (track.samples[position] ?? 0))
          }
        }

        await writer.write(int16Buffer(chunk))
      }
    } finally {
      await writer.close()
    }

    return { durationMs: durationMsForPcm(totalSamples, sampleRate) }
  }
}
