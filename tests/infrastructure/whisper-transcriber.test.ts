import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WhisperCppTranscriber,
  describeFailure,
  parseWhisperJson,
  type WhisperRunner
} from '@infrastructure/transcription/WhisperCppTranscriber'
import { WavFileWriter } from '@infrastructure/audio/wav'

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

  it('whisper が無音区間に生む定型のハルシネーションを除去する', () => {
    const raw = whisperJson([
      { from: 0, to: 2000, text: 'ご視聴ありがとうございました' },
      { from: 2000, to: 4000, text: 'ご清聴ありがとうございました。' },
      { from: 4000, to: 6000, text: 'チャンネル登録よろしくお願いします！' },
      { from: 6000, to: 8000, text: '来週の予定を確認します' }
    ])

    expect(parseWhisperJson(raw, 'self').map((s) => s.text)).toEqual(['来週の予定を確認します'])
  })

  it('ブロックリストの語を含むだけの本物の発話は消さない', () => {
    // 完全一致だけを落とすので、会議で実際に交わされる言葉は残る。
    const raw = whisperJson([
      { from: 0, to: 2000, text: '資料の共有ありがとうございました' },
      { from: 2000, to: 4000, text: 'ご視聴ありがとうございました、と冗談で言っていました' }
    ])

    expect(parseWhisperJson(raw, 'remote')).toHaveLength(2)
  })

  it('短く汎用的な語はブロックリストに載せない', () => {
    // 会議の締めで実際に発せられるため、ハルシネーションと区別がつかない。
    const raw = whisperJson([
      { from: 0, to: 1000, text: '終わり' },
      { from: 1000, to: 2000, text: 'おわり' }
    ])

    expect(parseWhisperJson(raw, 'self')).toHaveLength(2)
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

describe('describeFailure', () => {
  it('--vad を知らない古い whisper-cli には更新を促す', () => {
    const message = describeFailure(
      '/usr/local/bin/whisper-cli',
      new Error('Command failed'),
      'error: unknown argument: --vad\n'
    )

    expect(message).toContain('無音区間の除外（VAD）に対応していません')
    expect(message).toContain('v1.7.6 以降')
  })

  it('バイナリが無ければ setup を案内する', () => {
    const message = describeFailure('whisper-cli', new Error('spawn ENOENT'), '')

    expect(message).toContain("'npm run setup' を実行してください。")
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

  /** 渡された引数を記録しつつ、空の JSON だけ書き出すランナー。 */
  const captureArgv = (seen: string[][]): WhisperRunner => {
    return async ({ argv }) => {
      seen.push([...argv])
      const prefixIndex = argv.indexOf('--output-file')
      await writeFile(`${argv[prefixIndex + 1]}.json`, whisperJson([]), 'utf8')
    }
  }

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

  it('非発話トークンの抑制を常に有効にする', async () => {
    const seen: string[][] = []
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin' },
      captureArgv(seen)
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    expect(seen[0]).toContain('--suppress-nst')
  })

  it('VAD モデルが指定されていれば無音区間を whisper へ渡さない', async () => {
    const seen: string[][] = []
    const transcriber = new WhisperCppTranscriber(
      {
        binaryPath: 'whisper-cli',
        modelPath: '/models/ggml.bin',
        vadModelPath: '/models/ggml-silero.bin'
      },
      captureArgv(seen)
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    const argv = seen[0] ?? []
    expect(argv).toContain('--vad')
    expect(argv[argv.indexOf('--vad-model') + 1]).toBe('/models/ggml-silero.bin')
  })

  it('VAD モデルが無ければ VAD を使わずに文字起こしする', async () => {
    const seen: string[][] = []
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin', vadModelPath: '' },
      captureArgv(seen)
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    expect(seen[0]).not.toContain('--vad')
  })

  it('用語集があれば initial prompt として渡し、会議の最後まで効かせる', async () => {
    const seen: string[][] = []
    const transcriber = new WhisperCppTranscriber(
      {
        binaryPath: 'whisper-cli',
        modelPath: '/models/ggml.bin',
        glossary: ['Anthropic', 'Claude Code']
      },
      captureArgv(seen)
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    const argv = seen[0] ?? []
    expect(argv[argv.indexOf('--prompt') + 1]).toBe('Anthropic、Claude Code。')
    // これが無いと最初の 30 秒にしか効かない。
    expect(argv).toContain('--carry-initial-prompt')
  })

  it('用語集が空なら prompt を渡さない', async () => {
    const seen: string[][] = []
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin', glossary: [] },
      captureArgv(seen)
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    expect(seen[0]).not.toContain('--prompt')
    expect(seen[0]).not.toContain('--carry-initial-prompt')
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

  it('サンプルを持たない WAV は whisper を起動せず空の結果にする', async () => {
    // マイクの無い環境では mic.wav がヘッダだけで残る（ADR-017）。whisper-cli は
    // 中身の無い WAV を読めず、JSON を書かないまま終了コード 0 で終わるため、
    // 起動させると「mic.json が無い」という無関係な ENOENT で録音全体が失敗する。
    const emptyWav = join(dir, 'empty.wav')
    await (await WavFileWriter.create(emptyWav, { sampleRate: 16_000 })).close()

    let started = false
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin' },
      async () => {
        started = true
      }
    )

    expect(
      await transcriber.transcribe({ wavPath: emptyWav, language: 'ja', speakerId: 'self' })
    ).toEqual([])
    expect(started).toBe(false)
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
