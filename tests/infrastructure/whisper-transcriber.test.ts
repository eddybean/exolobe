import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WhisperCppTranscriber,
  parseWhisperJson,
  type WhisperRunner
} from '@infrastructure/transcription/WhisperCppTranscriber'

const whisperJson = (
  entries: { from: number; to: number; text: string }[]
): string =>
  JSON.stringify({
    transcription: entries.map((e) => ({ offsets: { from: e.from, to: e.to }, text: e.text }))
  })

describe('parseWhisperJson', () => {
  it('オフセットとテキストをセグメントへ変換し、指定の話者を付ける', () => {
    const raw = whisperJson([{ from: 0, to: 1500, text: ' おはようございます ' }])

    expect(parseWhisperJson(raw, 'self')).toEqual([
      { startMs: 0, endMs: 1500, speakerId: 'self', text: 'おはようございます' }
    ])
  })

  it('whisper が挿入する非発話マーカーを除去する', () => {
    const raw = whisperJson([
      { from: 0, to: 500, text: '[BLANK_AUDIO]' },
      { from: 500, to: 900, text: '(音楽)' },
      { from: 900, to: 1000, text: '♪' },
      { from: 1000, to: 2000, text: '本題に入ります' }
    ])

    expect(parseWhisperJson(raw, 'remote').map((s) => s.text)).toEqual(['本題に入ります'])
  })

  it('空文字や空白だけのセグメントを捨てる', () => {
    const raw = whisperJson([
      { from: 0, to: 100, text: '   ' },
      { from: 100, to: 200, text: '' }
    ])

    expect(parseWhisperJson(raw, 'self')).toEqual([])
  })

  it('オフセットが欠けたセグメントは捨てる', () => {
    const raw = JSON.stringify({ transcription: [{ text: 'タイムスタンプなし' }] })

    expect(parseWhisperJson(raw, 'self')).toEqual([])
  })

  it('transcription が無い JSON は空配列として扱う', () => {
    expect(parseWhisperJson('{}', 'self')).toEqual([])
  })

  it('JSON として壊れていれば利用者向けメッセージで失敗する', () => {
    expect(() => parseWhisperJson('{ broken', 'self')).toThrow(
      '文字起こし結果を読み取れませんでした。'
    )
  })
})

describe('WhisperCppTranscriber', () => {
  let dir: string
  let wavPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'omr-whisper-'))
    wavPath = join(dir, 'mic.wav')
    await writeFile(wavPath, 'dummy', 'utf8')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** whisper-cli の代わりに JSON を書き出すランナー。 */
  const runnerWriting = (entries: { from: number; to: number; text: string }[]): WhisperRunner => {
    return async ({ argv }) => {
      const prefixIndex = argv.indexOf('--output-file')
      await writeFile(`${argv[prefixIndex + 1]}.json`, whisperJson(entries), 'utf8')
    }
  }

  it('モデル・言語・出力先を whisper-cli へ渡す', async () => {
    const seen: string[][] = []
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin' },
      async ({ argv }) => {
        seen.push([...argv])
        const prefixIndex = argv.indexOf('--output-file')
        await writeFile(`${argv[prefixIndex + 1]}.json`, whisperJson([]), 'utf8')
      }
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    const argv = seen[0] ?? []
    expect(argv).toContain('--output-json')
    expect(argv[argv.indexOf('--model') + 1]).toBe('/models/ggml.bin')
    expect(argv[argv.indexOf('--language') + 1]).toBe('ja')
    expect(argv[argv.indexOf('--file') + 1]).toBe(wavPath)
  })

  it('書き出された JSON を読んでセグメントを返す', async () => {
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin' },
      runnerWriting([{ from: 0, to: 1000, text: 'こんにちは' }])
    )

    expect(await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'remote' })).toEqual([
      { startMs: 0, endMs: 1000, speakerId: 'remote', text: 'こんにちは' }
    ])
  })

  it('中間 JSON を残さない', async () => {
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin' },
      runnerWriting([{ from: 0, to: 1000, text: 'こんにちは' }])
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    await expect(stat(join(dir, 'mic.json'))).rejects.toThrow()
  })

  it('失敗しても中間 JSON を残さない', async () => {
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin' },
      async ({ argv }) => {
        const prefixIndex = argv.indexOf('--output-file')
        await writeFile(`${argv[prefixIndex + 1]}.json`, '{ broken', 'utf8')
      }
    )

    await expect(
      transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })
    ).rejects.toThrow()
    await expect(stat(join(dir, 'mic.json'))).rejects.toThrow()
  })

  it('モデル未設定なら設定画面へ誘導する', async () => {
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '' },
      runnerWriting([])
    )

    await expect(
      transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })
    ).rejects.toThrow('文字起こしモデルが設定されていません。設定画面でモデルを選んでください。')
  })
})
