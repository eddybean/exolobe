import { localized } from './locale'

const ja = {
  sectionAriaLabel: '録音中',
  assist: {
    ariaLabel: '録音中のアシスト',
    heading: 'アシスト',
    preview: 'リサーチプレビュー',
    status: {
      starting: '字幕を準備しています…',
      downloading: '音声認識のモデルを取得しています（初回だけ）…',
      unavailable: {
        missing: '音声認識のプログラムが見つかりません。',
        'unsupported-os': 'この macOS では使えません（macOS 26 以降）。',
        'unsupported-locale': '会議の言語の音声認識に対応していません。',
        crashed: '音声認識が止まりました。録音は続いています。'
      }
    },
    captions: {
      ariaLabel: 'ライブ字幕',
      empty: '話し始めると、ここに字幕が出ます',
      remote: '相手',
      self: '自分',
      note: '字幕は保存しません。録音を止めたあと、改めて文字起こしを作ります。'
    },
    headline: {
      ariaLabel: '今の話題',
      label: '今の話題',
      show: '要点を表示',
      hide: '要点を隠す'
    },
    suggestion: {
      ariaLabel: '関係しそうな過去の会議',
      label: '過去の会議',
      open: '開く',
      dismiss: '閉じる',
      at: (time: string) => `${time} 付近`
    },
    actions: {
      summarize: 'ここまでの要約',
      extract: 'ToDo・決定の候補',
      working: '作成中…',
      empty: '見つかりませんでした。',
      addToNotes: 'メモに追加',
      added: '追加済み',
      close: '閉じる',
      todo: 'ToDo',
      decision: '決定',
      caution: 'Apple Intelligence が字幕から作るため、誤りを含むことがあります。'
    }
  },
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
  assist: {
    ariaLabel: 'Live assist',
    heading: 'Assist',
    preview: 'Research Preview',
    status: {
      starting: 'Preparing captions…',
      downloading: 'Downloading the speech recognition model (first time only)…',
      unavailable: {
        missing: 'The speech recognition program was not found.',
        'unsupported-os': 'Not available on this version of macOS (requires macOS 26 or later).',
        'unsupported-locale': 'Speech recognition doesn’t support the meeting language.',
        crashed: 'Speech recognition stopped. Recording continues.'
      }
    },
    captions: {
      ariaLabel: 'Live captions',
      empty: 'Captions appear here once people start talking.',
      remote: 'Them',
      self: 'You',
      note: 'Captions aren’t saved. A full transcript is made after you stop recording.'
    },
    headline: {
      ariaLabel: 'Current topic',
      label: 'Current topic',
      show: 'Show key points',
      hide: 'Hide key points'
    },
    suggestion: {
      ariaLabel: 'Related past meeting',
      label: 'Past meeting',
      open: 'Open',
      dismiss: 'Dismiss',
      at: (time: string) => `around ${time}`
    },
    actions: {
      summarize: 'Summary So Far',
      extract: 'To-dos & Decisions',
      working: 'Working…',
      empty: 'Nothing found.',
      addToNotes: 'Add to Notes',
      added: 'Added',
      close: 'Close',
      todo: 'To-do',
      decision: 'Decision',
      caution: 'Apple Intelligence generates these from the captions, so they may contain mistakes.'
    }
  },
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
