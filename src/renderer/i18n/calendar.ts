import { localized } from './locale'

const ja = {
  title: 'カレンダー連携',
  fillLabel: '予定からタイトルと参加者を埋める',
  fillHint1: '録音を始めた時刻に重なる予定のタイトルを録音の名前にし、参加者を話者名の候補に出します。',
  fillHint2: '会議の URL を含む予定の時間帯にマイクが使われたら、録音を早めに促します。',
  fillHint3: 'macOS のカレンダーを読むだけで、どこにも送信しません。',
  autoStartLabel: '会議の予定の時間帯にマイクが使われたら、録音を自動で始める',
  autoStartHint1:
    'Google Meet・Zoom・Teams の URL を含む予定があり、他のアプリがマイクを 30 秒使い続けたときだけ始めます。',
  autoStartHint2:
    '始めたら通知で知らせ、「停止して破棄」で何も残さずに取り消せます。止めた会議では再び自動で始めません。',
  subjectName: 'カレンダー',
  subjectPurpose: '予定の読み取り',
  allow: '許可する',
  openSettings: 'システム設定を開く'
}

const en: typeof ja = {
  title: 'Calendar integration',
  fillLabel: 'Fill in the title and participants from the event',
  fillHint1:
    'Uses the title of the event overlapping the time you started recording as the recording’s name, and suggests participants as speaker names.',
  fillHint2:
    'Prompts you to record earlier if the microphone is used during an event that includes a meeting URL.',
  fillHint3: 'Only reads the macOS Calendar app — nothing is sent anywhere.',
  autoStartLabel: 'Start recording automatically when the microphone is used during a meeting event',
  autoStartHint1:
    'Starts only when there is an event with a Google Meet, Zoom, or Teams URL, and another app has kept using the microphone for 30 seconds.',
  autoStartHint2:
    'You’ll get a notification when it starts, and “Stop and Discard” cancels it without keeping anything. It won’t start again automatically for a meeting you stopped.',
  subjectName: 'Calendar',
  subjectPurpose: 'Reading events',
  allow: 'Allow',
  openSettings: 'Open System Settings'
}

/** カレンダー連携（CalendarSettings）の文言。 */
export const calendarText = localized({ ja, en })
