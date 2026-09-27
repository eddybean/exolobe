import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WhisperCppTranscriber,
  describeFailure,
  droppedSegmentLogger,
  formatDroppedSegment,
  parseWhisperJson,
  whisperProgressReader,
  type DroppedSegment,
  type WhisperRunner
} from '@infrastructure/transcription/WhisperCppTranscriber'
import { WavFileWriter } from '@infrastructure/audio/wav'

const whisperJson = (
  entries: { from: number; to: number; text: string }[]
): string =>
  JSON.stringify({
    transcription: entries.map((e) => ({ offsets: { from: e.from, to: e.to }, text: e.text }))
  })

const whisperJsonWithTokens = (
  entries: { from: number; to: number; text: string; tokenProbs: number[] }[]
): string =>
  JSON.stringify({
    transcription: entries.map((e) => ({
      offsets: { from: e.from, to: e.to },
      text: e.text,
      tokens: e.tokenProbs.map((p) => ({ text: '.', p }))
    }))
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

  it('平均対数確率が閾値を下回るセグメントを捨てる', () => {
    // p=0.2 → ln(0.2) ≈ -1.61 で --logprob-thold の既定 -1.0 を下回る。
    const raw = whisperJsonWithTokens([
      { from: 0, to: 2000, text: '雑音から生まれた文', tokenProbs: [0.2, 0.2, 0.2] },
      { from: 2000, to: 4000, text: '予算の話をします', tokenProbs: [0.9, 0.95, 0.88] }
    ])

    expect(parseWhisperJson(raw, 'self').map((s) => s.text)).toEqual(['予算の話をします'])
  })

  it('閾値ちょうどのセグメントは残す', () => {
    // 落とすのは確信度が閾値を「下回った」ときだけ。境界は発話側に倒す。
    const raw = whisperJsonWithTokens([
      { from: 0, to: 2000, text: '判断に迷う発話', tokenProbs: [Math.exp(-1), Math.exp(-1)] }
    ])

    expect(parseWhisperJson(raw, 'self')).toHaveLength(1)
  })

  it('特殊トークンの確率は平均に含めない', () => {
    // [_BEG_] などは発話ではないため、本文の確信度を歪めてはいけない。
    const raw = JSON.stringify({
      transcription: [
        {
          offsets: { from: 0, to: 2000 },
          text: '来週の予定です',
          tokens: [
            { text: '[_BEG_]', p: 0.01 },
            { text: '来週', p: 0.9 },
            { text: 'の予定です', p: 0.9 },
            { text: '[_TT_100]', p: 0.01 }
          ]
        }
      ]
    })

    expect(parseWhisperJson(raw, 'self')).toHaveLength(1)
  })

  it('確率を持たないトークンしか無ければ確信度で判断しない', () => {
    // 判断材料が無いことを「確信度が低い」と読み替えて消すと、本物の発話を失う。
    const raw = JSON.stringify({
      transcription: [
        {
          offsets: { from: 0, to: 2000 },
          text: '確率の無い発話',
          tokens: [{ text: '確率の無い発話' }]
        }
      ]
    })

    expect(parseWhisperJson(raw, 'self')).toHaveLength(1)
  })

  it('tokens を持たない JSON は従来どおり全て残す', () => {
    // --output-json-full に対応しない whisper-cli でも文字起こしは成立させる。
    const raw = whisperJson([{ from: 0, to: 2000, text: '本題に入ります' }])

    expect(parseWhisperJson(raw, 'self')).toHaveLength(1)
  })

  it('計測モードを渡さなければ何も報告しない', () => {
    // 通常の利用では落とした事実をどこにも出さない。
    const raw = whisperJsonWithTokens([
      { from: 0, to: 2000, text: '雑音から生まれた文', tokenProbs: [0.2, 0.2] }
    ])

    expect(parseWhisperJson(raw, 'self')).toEqual([])
  })

  it('計測モードでは確信度で落としたセグメントを対数確率つきで報告する', () => {
    const dropped: DroppedSegment[] = []
    const raw = whisperJsonWithTokens([
      { from: 1000, to: 2000, text: '雑音から生まれた文', tokenProbs: [0.2, 0.2] },
      { from: 2000, to: 4000, text: '予算の話をします', tokenProbs: [0.9, 0.9] }
    ])

    parseWhisperJson(raw, 'remote', (d) => dropped.push(d))

    expect(dropped).toHaveLength(1)
    expect(dropped[0]).toMatchObject({
      speakerId: 'remote',
      startMs: 1000,
      endMs: 2000,
      text: '雑音から生まれた文',
      reason: 'low-confidence'
    })
    expect(dropped[0]?.avgLogprob).toBeCloseTo(Math.log(0.2), 5)
  })

  it('計測モードでは非発話マーカーと定型句も理由を分けて報告する', () => {
    // 閾値の妥当性を見るには、どの関門で落ちたかが分かる必要がある。
    const dropped: DroppedSegment[] = []
    const raw = whisperJson([
      { from: 0, to: 500, text: '[BLANK_AUDIO]' },
      { from: 500, to: 1000, text: 'ご視聴ありがとうございました' },
      { from: 1000, to: 2000, text: '本題に入ります' }
    ])

    parseWhisperJson(raw, 'self', (d) => dropped.push(d))

    expect(dropped.map((d) => d.reason)).toEqual(['non-speech', 'boilerplate'])
  })

  it('確率 0 のトークンがあっても他のセグメントを巻き込まない', () => {
    // ln(0) = -Infinity を平均へ持ち込むと NaN 汚染で全滅しかねない。
    const raw = whisperJsonWithTokens([
      { from: 0, to: 2000, text: '確率ゼロ', tokenProbs: [0, 0.9] },
      { from: 2000, to: 4000, text: '正常な発話', tokenProbs: [0.9, 0.9] }
    ])

    expect(parseWhisperJson(raw, 'self').map((s) => s.text)).toEqual(['正常な発話'])
  })
})

describe('formatDroppedSegment', () => {
  it('時刻・話者・理由・対数確率・本文を 1 行にまとめる', () => {
    const line = formatDroppedSegment({
      speakerId: 'remote',
      startMs: 3_723_450,
      endMs: 3_725_000,
      text: '雑音から生まれた文',
      reason: 'low-confidence',
      avgLogprob: -1.4237
    })

    expect(line).toBe(
      '[dropped:low-confidence] 01:02:03.450-01:02:05.000 remote logprob=-1.424 「雑音から生まれた文」'
    )
  })

  it('対数確率が無い理由では logprob を書かない', () => {
    const line = formatDroppedSegment({
      speakerId: 'self',
      startMs: 0,
      endMs: 500,
      text: '[BLANK_AUDIO]',
      reason: 'non-speech'
    })

    expect(line).toBe('[dropped:non-speech] 00:00:00.000-00:00:00.500 self 「[BLANK_AUDIO]」')
  })
})

describe('droppedSegmentLogger', () => {
  it('環境変数が無ければ計測しない', () => {
    // 通常の利用では落とした本文をログへ出さない。
    expect(droppedSegmentLogger({}, () => {})).toBeUndefined()
  })

  it('空文字や 0 では計測しない', () => {
    expect(droppedSegmentLogger({ OMR_LOG_DROPPED_SEGMENTS: '' }, () => {})).toBeUndefined()
    expect(droppedSegmentLogger({ OMR_LOG_DROPPED_SEGMENTS: '0' }, () => {})).toBeUndefined()
  })

  it('有効なら整形した 1 行を書き出す', () => {
    const lines: string[] = []
    const report = droppedSegmentLogger({ OMR_LOG_DROPPED_SEGMENTS: '1' }, (l) => lines.push(l))

    report?.({
      speakerId: 'self',
      startMs: 0,
      endMs: 500,
      text: '[BLANK_AUDIO]',
      reason: 'non-speech'
    })

    expect(lines).toEqual(['[dropped:non-speech] 00:00:00.000-00:00:00.500 self 「[BLANK_AUDIO]」'])
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

describe('whisperProgressReader', () => {
  it('whisper-cli の進捗行から割合を読み取る', () => {
    const seen: number[] = []
    const read = whisperProgressReader((fraction) => seen.push(fraction))

    read('whisper_print_progress_callback: progress =  21%\n')
    read('whisper_print_progress_callback: progress = 100%\n')

    expect(seen).toEqual([0.21, 1])
  })

  it('チャンクの途中で切れた行もつなげて読む', () => {
    // stderr は行の区切りと無関係に届く。切れ目で読むと「2%」と「1%」に割れる。
    const seen: number[] = []
    const read = whisperProgressReader((fraction) => seen.push(fraction))

    read('whisper_print_progress_callback: progress =  2')
    read('1%\nggml_metal_free: deallocating\n')

    expect(seen).toEqual([0.21])
  })

  it('進捗ではない行は無視する', () => {
    const seen: number[] = []
    const read = whisperProgressReader((fraction) => seen.push(fraction))

    read('load_backend: loaded BLAS backend\nwhisper_init_state: kv self size = 10%\n')

    expect(seen).toEqual([])
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

  it('進捗を出させ、読み取った割合を呼び出し側へ渡す', async () => {
    const seen: string[][] = []
    const fractions: number[] = []
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin' },
      async ({ argv, onStderr }) => {
        seen.push([...argv])
        onStderr?.('whisper_print_progress_callback: progress =  50%\n')
        const prefixIndex = argv.indexOf('--output-file')
        await writeFile(`${argv[prefixIndex + 1]}.json`, whisperJson([]), 'utf8')
      }
    )

    await transcriber.transcribe({
      wavPath,
      language: 'ja',
      speakerId: 'self',
      onProgress: (fraction) => fractions.push(fraction)
    })

    // --no-prints のままでも進捗は stderr に出る（実物の whisper-cli で確認済み）。
    expect(seen[0]).toContain('--print-progress')
    expect(fractions).toEqual([0.5])
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

  it('計測モードが設定されていれば落としたセグメントを話者つきで渡す', async () => {
    const dropped: DroppedSegment[] = []
    const transcriber = new WhisperCppTranscriber(
      {
        binaryPath: 'whisper-cli',
        modelPath: '/models/ggml.bin',
        onDropped: (d) => dropped.push(d)
      },
      async ({ argv }) => {
        const prefixIndex = argv.indexOf('--output-file')
        await writeFile(
          `${argv[prefixIndex + 1]}.json`,
          whisperJson([{ from: 0, to: 500, text: '[BLANK_AUDIO]' }]),
          'utf8'
        )
      }
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'remote' })

    expect(dropped).toHaveLength(1)
    expect(dropped[0]?.speakerId).toBe('remote')
  })

  it('トークンの確率を得るため JSON をフル出力させる', async () => {
    // --output-json-full が無いと p が書かれず、確信度で落とす判断ができない。
    const seen: string[][] = []
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin' },
      captureArgv(seen)
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    expect(seen[0]).toContain('--output-json-full')
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

  it('VAD を使うときはログを出させ、発話区間をまたいだ発言を区間ごとに切り直す', async () => {
    // 区間の対応表はログにしか出ない。--no-prints を付けると消える（ADR-036）。
    const seen: string[][] = []
    const transcriber = new WhisperCppTranscriber(
      {
        binaryPath: 'whisper-cli',
        modelPath: '/models/ggml.bin',
        vadModelPath: '/models/ggml-silero.bin'
      },
      async ({ argv, onStderr }) => {
        seen.push([...argv])
        // 行の途中で割れて届いても読めること。
        onStderr?.('whisper_vad: vad_segment_info: orig_start: 0.00, orig_end: 1.98, vad_st')
        onStderr?.(
          'art: 0.00, vad_end: 1.98\n' +
            'whisper_vad: vad_segment_info: orig_start: 62.50, orig_end: 63.33, vad_start: 2.18, vad_end: 3.01\n'
        )
        const prefixIndex = argv.indexOf('--output-file')
        await writeFile(
          `${argv[prefixIndex + 1]}.json`,
          JSON.stringify({
            transcription: [
              {
                offsets: { from: 0, to: 63_300 },
                text: 'では。了解です。',
                tokens: [
                  { text: 'では。', offsets: { from: 20, to: 400 }, p: 0.9 },
                  { text: '了解です。', offsets: { from: 2_200, to: 2_900 }, p: 0.9 }
                ]
              }
            ]
          }),
          'utf8'
        )
      }
    )

    const segments = await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    expect(seen[0]).not.toContain('--no-prints')
    expect(segments).toEqual([
      { startMs: 0, endMs: 1_980, speakerId: 'self', text: 'では。' },
      { startMs: 62_500, endMs: 63_300, speakerId: 'self', text: '了解です。' }
    ])
  })

  it('VAD を使わないときはログを出させない（読むものが無い）', async () => {
    const seen: string[][] = []
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin' },
      captureArgv(seen)
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    expect(seen[0]).toContain('--no-prints')
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

  it('VAD を使わず用語集も空なら、直前の出力を次のウィンドウへ引き継がせない', async () => {
    const seen: string[][] = []
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin', glossary: [] },
      captureArgv(seen)
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    const argv = seen[0] ?? []
    expect(argv[argv.indexOf('--max-context') + 1]).toBe('0')
  })

  it('VAD を使うなら文脈の上限を変えない（句読点や小さな声を落とすだけになるため）', async () => {
    const seen: string[][] = []
    const transcriber = new WhisperCppTranscriber(
      {
        binaryPath: 'whisper-cli',
        modelPath: '/models/ggml.bin',
        vadModelPath: '/models/ggml-silero.bin',
        glossary: []
      },
      captureArgv(seen)
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    expect(seen[0]).not.toContain('--max-context')
  })

  it('用語集があれば文脈の上限を変えない（用語集ごと消えるため）', async () => {
    const seen: string[][] = []
    const transcriber = new WhisperCppTranscriber(
      { binaryPath: 'whisper-cli', modelPath: '/models/ggml.bin', glossary: ['Anthropic'] },
      captureArgv(seen)
    )

    await transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'self' })

    expect(seen[0]).not.toContain('--max-context')
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
