import { localized } from './locale'

const ja = {
  sectionAriaLabel: '録音中',
  status: {
    ariaLabel: '録音の状態',
    label: '録音中',
    startedAt: (time: string) => `${time} 開始`,
    elapsedAriaLabel: '経過時間'
  },
  meter: {
    remoteLabel: '相手',
    remoteSource: 'システム音声',
    selfLabel: '自分',
    selfSource: 'マイク',
    unavailable: '取得できていません',
    ariaLabel: (label: string) => `${label}の入力レベル`
  },
  bookmark: {
    sectionAriaLabel: '印',
    button: '今の発言に印をつける',
    hint: '印は録音後の文字起こしに残り、要約で優先されます',
    text: '印'
  },
  notes: {
    sectionAriaLabel: '会議中のメモ',
    heading: '会議中のメモ',
    hint: '要点だけで十分です。細部は文字起こしが拾います',
    saved: '保存済み',
    saving: '保存中…',
    placeholder: '- 決まったこと\n- 気になった論点',
    ariaLabel: '会議中のメモ',
    footnote:
      '録音を止めると、このメモと文字起こしを合わせて要約を作ります。各行は書き始めた時刻つきで保存され、録音後にその位置へ戻れます。'
  }
}

const en: typeof ja = {
  sectionAriaLabel: 'Recording',
  status: {
    ariaLabel: 'Recording status',
    label: 'Recording',
    startedAt: (time: string) => `Started at ${time}`,
    elapsedAriaLabel: 'Elapsed time'
  },
  meter: {
    remoteLabel: 'Participants',
    remoteSource: 'System audio',
    selfLabel: 'You',
    selfSource: 'Microphone',
    unavailable: 'Not available',
    ariaLabel: (label: string) => `${label} input level`
  },
  bookmark: {
    sectionAriaLabel: 'Bookmarks',
    button: 'Bookmark This Moment',
    hint: 'Bookmarks stay in the transcript after recording and are prioritized in the summary.',
    text: 'Bookmark'
  },
  notes: {
    sectionAriaLabel: 'Notes during the meeting',
    heading: 'Notes',
    hint: 'Just the highlights — the transcript catches the details.',
    saved: 'Saved',
    saving: 'Saving…',
    placeholder: '- Decisions\n- Points worth revisiting',
    ariaLabel: 'Notes during the meeting',
    footnote:
      'Stopping the recording builds a summary from these notes and the transcript together. Each line is saved with the time you started writing it, so you can jump back to that point after recording.'
  }
}

/** 録音中の詳細画面（RecordingLiveView）の文言。 */
export const liveText = localized({ ja, en })
