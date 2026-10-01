import { localized } from './locale'

const ja = {
  audio: {
    pendingRecording: '録音を止めると処理が始まり、終わると再生できます。',
    pendingProcessing: 'エンコードが終わると再生できます。'
  },
  voiceprint: {
    summary: (samples: number, day: string) => `${samples} 件の録音から学習 ・ ${day}`,
    count: (count: number) => `${count} 人を覚えています`
  },
  voiceLearned: {
    notRemembered: (label: string) => `「${label}」の声は覚えられませんでした`,
    withMessage: (head: string, message: string) => `${head} ―― ${message}`,
    withoutMessage: (head: string) => `${head}。この名前は次回以降の録音には引き継がれません。`
  }
}

const en: typeof ja = {
  audio: {
    pendingRecording: 'Playback becomes available once processing finishes after you stop recording.',
    pendingProcessing: 'Playback becomes available once encoding finishes.'
  },
  voiceprint: {
    summary: (samples, day) => `Learned from ${samples} ${samples === 1 ? 'recording' : 'recordings'} · ${day}`,
    count: (count) => `${count} ${count === 1 ? 'voice' : 'voices'} remembered`
  },
  voiceLearned: {
    notRemembered: (label) => `Couldn't remember the voice for "${label}"`,
    withMessage: (head, message) => `${head} — ${message}`,
    withoutMessage: (head) => `${head}. This name won't carry over to future recordings.`
  }
}

/** 音声プレビュー・声紋帳・声の学習に関わる短い文言。 */
export const libraryText = localized({ ja, en })
