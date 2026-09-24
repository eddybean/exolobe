import { INPUT_CHECK } from '@domain/InputCheck'

/** 1 音の長さ。高低 2 音を交互に鳴らし、機械的な警告音に聞こえないようにする。 */
const NOTE_SEC = 0.4
const NOTES_HZ = [880, 1_320] as const
/**
 * 音量（0〜1）。テストの判定（INPUT_CHECK.audibleThreshold）を十分に超え、
 * 耳障りにならない大きさ。システム音声は音量を下げる前の音を取るので（ADR-001）、
 * Mac の音量を絞っていても判定には影響しない。
 */
const GAIN = 0.15

/**
 * テスト録音の確認音を鳴らす。アプリが鳴らした音がシステム音声として取れれば、
 * システム音声の許可があると分かる。
 */
export const playCheckTone = (): { stop(): void } => {
  const context = new AudioContext()
  const gain = context.createGain()
  gain.gain.value = 0
  gain.connect(context.destination)

  const oscillator = context.createOscillator()
  oscillator.type = 'sine'
  oscillator.connect(gain)

  const start = context.currentTime
  const count = Math.floor(INPUT_CHECK.toneDurationMs / 1_000 / NOTE_SEC)
  for (let index = 0; index < count; index += 1) {
    const at = start + index * NOTE_SEC
    oscillator.frequency.setValueAtTime(NOTES_HZ[index % NOTES_HZ.length] ?? NOTES_HZ[0], at)
    // 立ち上がりと減衰を付けないと、音の切れ目でプツッと鳴る。
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(GAIN, at + 0.03)
    gain.gain.linearRampToValueAtTime(0, at + NOTE_SEC - 0.05)
  }
  oscillator.start(start)
  oscillator.stop(start + count * NOTE_SEC)

  return {
    stop: () => {
      void context.close()
    }
  }
}
