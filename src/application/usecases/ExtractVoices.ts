import type {
  AudioDecoderPort,
  RecordingArtifactPort,
  RecordingRepositoryPort,
  SpeakerEmbeddingPort
} from '@application/ports'
import { ConfigurationError, RecordingNotFoundError } from '@domain/errors'
import type { RecordingVoices, SpeakerVector } from '@domain/Voiceprint'
import { remoteSpeakerId } from '@domain/Speaker'
import { voiceTurnsFromTranscript } from '@domain/VoiceTurns'

/**
 * 声紋を取り出すときのサンプリングレート。
 *
 * 設定の `audio.sampleRate` ではなく固定にしてある。埋め込みモデル（CampPlus）の
 * ネイティブが 16kHz で、設定を変えた後に取り直しても過去の声紋と比べられる値で
 * なければ意味がない。保存済みの audio.m4a も既に 16kHz なので、変換で失うものは無い。
 */
export const VOICE_EXTRACTION_SAMPLE_RATE = 16_000

export interface ExtractVoicesDeps {
  readonly repository: RecordingRepositoryPort
  readonly artifacts: RecordingArtifactPort
  readonly embedder: SpeakerEmbeddingPort
  readonly decoder: AudioDecoderPort
}

/**
 * 完了済みの録音から声紋（voices.json）を取り直す。
 *
 * 話者識別が済んだ後に名前を付けるのが普通の使い方なので、パイプラインが回った時点の
 * 声紋が無い録音——機能が入る前に録ったもの、話者識別を後から有効にしたもの——でも
 * 名前を覚えられるようにする。中間 WAV は完了時に消えているため、入力は保存先の
 * audio.m4a になる。
 *
 * 話者識別そのものはやり直さない。クラスタの割り当ては transcript.json に残っており、
 * やり直せばクラスタ番号が振り直されて、利用者が見ている話者の並びと既に付けた名前の
 * 対応が崩れる。ここでやるのは音を戻して声紋を取ることだけ。
 *
 * できた voices.json がそのままキャッシュになる。同じ録音で 2 人目、3 人目に名前を
 * 付けるときは変換も抽出も走らない。
 */
export class ExtractVoices {
  constructor(private readonly deps: ExtractVoicesDeps) {}

  async execute(recordingId: string): Promise<RecordingVoices> {
    const recording = await this.deps.repository.find(recordingId)
    if (!recording) throw new RecordingNotFoundError(recordingId)

    const modelKey = this.deps.embedder.modelKey
    const existing = await this.deps.artifacts.readVoices(recording)
    // 声紋が空の voices.json は、抽出に失敗した回が残したもの（ProcessRecording が
    // 抽出より先に書く）。作り直す価値があるので、無いものとして扱う。
    if (existing && existing.modelKey === modelKey && existing.speakers.length > 0) {
      return existing
    }

    // 空の modelKey は NullSpeakerEmbedder、つまり話者識別が無効かモデルが未取得。
    if (modelKey.length === 0) {
      throw new ConfigurationError('話者識別が無効なため、この録音から声を覚えられません。')
    }

    const transcript = await this.deps.artifacts.readTranscript(recording)
    if (!transcript) {
      throw new ConfigurationError('文字起こしがまだありません。')
    }

    const turns = voiceTurnsFromTranscript(transcript.segments)
    if (turns.length === 0) {
      throw new ConfigurationError(
        'この録音は話者が分かれていないため、声を覚えられません。'
      )
    }

    const audioPath = await this.deps.artifacts.audioPath(recording)

    const speakers = await this.deps.artifacts.withVoicesWav(recording, async (wavPath) => {
      await this.deps.decoder.decode({
        inputPath: audioPath,
        outputPath: wavPath,
        sampleRate: VOICE_EXTRACTION_SAMPLE_RATE
      })

      const embedded = await this.deps.embedder.embedSpeakers({ wavPath, turns })
      return embedded.map(
        ({ speaker, vector }): SpeakerVector => ({ speakerId: remoteSpeakerId(speaker), vector })
      )
    })

    const voices: RecordingVoices = { modelKey, speakers }
    await this.deps.artifacts.writeVoices(recording, voices)
    return voices
  }
}
