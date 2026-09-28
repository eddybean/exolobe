import { localized } from './locale'

const ja = {
  micGranted: '許可済み',
  micNotDetermined: 'まだ許可していません',
  micDenied: '許可されていません',
  micUnknown: '確認できません',
  calendarWriteOnly: '予定の追加だけが許可されています',
  calendarUnavailable: 'この環境では使えません',
  systemAudioSubject: '相手の声（システム音声）',
  systemAudioMessage:
    '確認音が取れませんでした。システム設定でこのアプリの「システムオーディオ録音」を許可してから、もう一度テストしてください。許可のダイアログがいま出た場合は、許可した後にもう一度テストすれば取れます。',
  micSubject: '自分の声（マイク）',
  micMessage:
    'マイクに音が入りませんでした。マイクに向かって話しながら、もう一度テストしてください。外付けのマイクを使っている場合は、つながっているかも確かめてください。',
  // RecordingPermissions.tsx
  cardTitle: '録音に必要な許可',
  micName: 'マイク',
  micPurpose: '自分の声',
  requestAllow: '許可する',
  openSettings: 'システム設定を開く',
  systemAudioName: 'システム音声',
  systemAudioPurpose: '相手の声',
  systemAudioState: 'アプリからは確認できません',
  // 文の区切り方が言語で違う（日本語は句点の後に空白を置かない）ので、2 文を 1 つの文言に持つ。
  hint:
    '初めて録音するとき（下のテスト録音でも）に macOS が許可を求めます。許可が無くてもエラーにはならず、相手の声が無音のまま録音されます。' +
    'システム設定の「画面収録とシステムオーディオ録音」にある「システムオーディオ録音のみ」で、このアプリがオンになっていれば問題ありません。',
  testButton: 'テスト録音',
  testing: 'テスト中…',
  testHint: '約 3 秒。確認音が鳴ります。マイクに向かって何か話してください。何も保存しません。',
  heard: '入りました',
  notHeard: '入りませんでした'
}

const en: typeof ja = {
  micGranted: 'Allowed',
  micNotDetermined: 'Not yet allowed',
  micDenied: 'Not allowed',
  micUnknown: 'Cannot be checked',
  calendarWriteOnly: 'Only adding events is allowed',
  calendarUnavailable: 'Not available in this environment',
  systemAudioSubject: 'The other side’s voice (system audio)',
  systemAudioMessage:
    'No confirmation tone was picked up. Allow “System Audio Recording” for this app in System Settings, then test again. If a permission dialog just appeared, testing once more after allowing it should pick up the tone.',
  micSubject: 'Your voice (microphone)',
  micMessage:
    'No sound was picked up from the microphone. Test again while speaking toward the microphone. If you’re using an external microphone, also check that it’s connected.',
  // RecordingPermissions.tsx
  cardTitle: 'Permissions needed to record',
  micName: 'Microphone',
  micPurpose: 'Your voice',
  requestAllow: 'Allow',
  openSettings: 'Open System Settings',
  systemAudioName: 'System Audio',
  systemAudioPurpose: 'The other side’s voice',
  systemAudioState: 'Cannot be checked from the app',
  hint:
    'macOS asks for permission the first time you record (including with the test recording below). Recording does not fail without it — the other side’s voice is simply recorded as silence. ' +
    'Check that this app is turned on under System Settings > Screen & System Audio Recording > System Audio Recording Only.',
  testButton: 'Test Recording',
  testing: 'Testing…',
  testHint: 'About 3 seconds. A confirmation tone plays. Say something toward the microphone. Nothing is saved.',
  heard: 'Picked up',
  notHeard: 'Not picked up'
}

/** 許可の状態表示（RecordingPermissions / CalendarSettings / permissions.ts）の文言。 */
export const permissionsText = localized({ ja, en })
