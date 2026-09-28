import { localized } from './locale'

/**
 * ステップの状態表記。呼び出し側は `RecordingDetailDto` の `status` が単なる
 * string のため、既知の 5 種類に加えて任意の文字列で引ける形にしておく。
 */
interface StepStateLabels extends Record<string, string> {
  readonly pending: string
  readonly queued: string
  readonly running: string
  readonly done: string
  readonly failed: string
}

const stepStateJa: StepStateLabels = {
  pending: '待機',
  queued: '順番待ち',
  running: '処理中',
  done: '完了',
  failed: '失敗'
}

const stepStateEn: StepStateLabels = {
  pending: 'Pending',
  queued: 'Queued',
  running: 'Processing',
  done: 'Done',
  failed: 'Failed'
}

const ja = {
  /** 日時と長さの間の区切り。 */
  metaSeparator: ' ・ ',
  header: {
    revealInFinder: 'Finder で表示',
    delete: '削除'
  },
  transcript: {
    heading: '文字起こし',
    copyLabel: '文字起こしをコピー',
    empty: 'まだ文字起こしがありません。',
    seekTitle: 'この位置から再生',
    seekDisabledTitle: 'エンコードが終わると再生できます',
    bookmarkTitle: '録音中に印をつけた発言',
    bookmarkText: '録音中に印'
  },
  tabs: {
    summary: '要約',
    note: 'メモ'
  },
  summary: {
    cancel: 'キャンセル',
    save: '保存',
    saving: '保存中…',
    edit: '編集',
    editHint: '要約を手で直す',
    editDisabledHint: '要約が終わると直せます',
    copyLabel: '要約をコピー',
    placeholder: '要約を Markdown で書けます',
    ariaLabel: '要約の編集',
    empty: 'まだ要約がありません。'
  },
  resummarize: {
    hint: {
      ready: '話者名や本文を直したあとなど、要約を作り直す',
      summarizing: '要約を作り直しています',
      queued: '順番が来ると要約し直します',
      busy: '他の処理が終わると要約し直せます',
      unavailable: '文字起こしができると要約し直せます'
    },
    label: {
      ready: '再要約',
      summarizing: '要約中…',
      queued: '要約待ち…',
      busy: '再要約',
      unavailable: '再要約'
    }
  },
  note: {
    saved: '保存済み',
    saving: '保存中…',
    placeholder: 'この会議についてのメモを書けます（自動保存されます）',
    momentAriaLabel: 'メモと印の時刻',
    momentSeekTitle: 'この位置の発言へ移動して再生',
    momentGoTitle: 'この位置の発言へ移動',
    bookmarkText: '印'
  },
  pipeline: {
    stepState: stepStateJa,
    popupAriaLabel: '処理状況',
    processing: '処理中',
    continuesInBackground: 'ウィンドウを閉じても続きます',
    stepProgressAriaLabel: (label: string) => `${label}の進み具合`
  },
  failures: {
    joinLabels: (labels: readonly string[]) => labels.join('・'),
    queuedMessage: (labels: string) => `${labels}の順番を待っています`,
    retry: '再実行'
  }
}

const en: typeof ja = {
  metaSeparator: ' · ',
  header: {
    revealInFinder: 'Show in Finder',
    delete: 'Delete'
  },
  transcript: {
    heading: 'Transcript',
    copyLabel: 'Copy Transcript',
    empty: 'No transcript yet.',
    seekTitle: 'Play from here',
    seekDisabledTitle: 'Playback becomes available once encoding finishes',
    bookmarkTitle: 'Bookmarked during recording',
    bookmarkText: 'Bookmarked'
  },
  tabs: {
    summary: 'Summary',
    note: 'Notes'
  },
  summary: {
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
    edit: 'Edit',
    editHint: 'Edit the summary by hand',
    editDisabledHint: 'You can edit once the summary is done',
    copyLabel: 'Copy Summary',
    placeholder: 'You can write the summary in Markdown',
    ariaLabel: 'Edit summary',
    empty: 'No summary yet.'
  },
  resummarize: {
    hint: {
      ready: 'Regenerate the summary, e.g. after correcting speaker names or text',
      summarizing: 'Regenerating the summary…',
      queued: 'Will regenerate once its turn comes',
      busy: 'You can regenerate once other processing finishes',
      unavailable: 'You can regenerate once a transcript is available'
    },
    label: {
      ready: 'Summarize Again',
      summarizing: 'Summarizing…',
      queued: 'Queued…',
      busy: 'Summarize Again',
      unavailable: 'Summarize Again'
    }
  },
  note: {
    saved: 'Saved',
    saving: 'Saving…',
    placeholder: 'Write notes about this meeting (saved automatically)',
    momentAriaLabel: 'Note and bookmark times',
    momentSeekTitle: 'Jump to this segment and play',
    momentGoTitle: 'Jump to this segment',
    bookmarkText: 'Bookmark'
  },
  pipeline: {
    stepState: stepStateEn,
    popupAriaLabel: 'Processing status',
    processing: 'Processing',
    continuesInBackground: 'Continues even if you close the window',
    stepProgressAriaLabel: (label: string) => `${label} progress`
  },
  failures: {
    joinLabels: (labels: readonly string[]) =>
      labels.length <= 1
        ? (labels[0] ?? '')
        : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1] ?? ''}`,
    queuedMessage: (labels: string) => `Waiting for ${labels}`,
    retry: 'Run Again'
  }
}

/** 録音詳細画面（RecordingDetailView）の文言。 */
export const detailText = localized({ ja, en })
