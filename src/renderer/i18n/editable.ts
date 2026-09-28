import { localized } from './locale'

const ja = {
  copy: {
    copy: 'コピー',
    copied: 'コピーしました'
  },
  player: {
    pause: '一時停止',
    play: '再生',
    playDisabledHint: 'エンコードが終わると再生できます',
    toggleHint: (label: string) => `${label}（Space）`,
    rateAriaLabel: (rate: string) => `再生速度 ${rate}（押すたびに切り替え）`,
    rateHint: '再生速度（押すたびに切り替え）',
    unmute: 'ミュートを解除',
    mute: 'ミュート',
    volume: '音量'
  },
  title: {
    hint: 'クリックしてタイトルを変更',
    ariaLabel: 'タイトル'
  },
  speaker: {
    hint: 'クリックして話者名を変更',
    ariaLabel: '話者名'
  },
  segmentText: {
    edit: '直す',
    editHint: '音声を聞いて本文を直す',
    ariaLabel: '発言の本文',
    keyHint: 'Enter で保存 ・ Esc で取り消し ・ 時刻を押すと直しながら聞き直せます'
  },
  timeline: {
    laneAriaLabel: (label: string) => `${label}の発言の帯。押した発言から再生`
  }
}

const en: typeof ja = {
  copy: {
    copy: 'Copy',
    copied: 'Copied'
  },
  player: {
    pause: 'Pause',
    play: 'Play',
    playDisabledHint: 'Playback becomes available once encoding finishes',
    toggleHint: (label: string) => `${label} (Space)`,
    rateAriaLabel: (rate: string) => `Playback speed ${rate} (click to cycle)`,
    rateHint: 'Playback speed (click to cycle)',
    unmute: 'Unmute',
    mute: 'Mute',
    volume: 'Volume'
  },
  title: {
    hint: 'Click to rename',
    ariaLabel: 'Title'
  },
  speaker: {
    hint: 'Click to rename speaker',
    ariaLabel: 'Speaker name'
  },
  segmentText: {
    edit: 'Edit',
    editHint: 'Listen to the audio to correct the text',
    ariaLabel: 'Segment text',
    keyHint: 'Enter to save · Esc to cancel · click the time to keep listening while you edit'
  },
  timeline: {
    laneAriaLabel: (label: string) => `${label}'s speaking segments. Click to play from there`
  }
}

/** 再生周りの小さな部品（プレーヤー操作・インライン編集・タイムライン・コピー）の文言。 */
export const editableText = localized({ ja, en })
