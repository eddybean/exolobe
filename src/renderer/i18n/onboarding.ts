import { localized } from './locale'

const ja = {
  title: 'はじめに',
  lead: '会議の音声を録音し、文字起こし・話者識別・要約までをこの Mac の中だけで行います。音声もテキストも外部には送信されません。',
  step1Title: '保存先を選ぶ',
  step1Description: '録音・文字起こし・要約の保存場所です。これを決めると録音を始められます。',
  unset: '未設定',
  choose: '選択',
  change: '変更',
  modelsSectionTitle: 'モデルを取得する',
  modelsLead1: '文字起こしと要約に使うモデルをダウンロードします。合計で約 5.7GB あり、回線によっては時間がかかります。中断しても途中から再開できます。',
  modelsLeadStrong: 'モデルが無くても録音は始められます',
  modelsLead2: 'ので、先に会議を録っておいて後から処理することもできます。',
  settingsNote1: '細かい設定や、手元にあるモデルの指定は',
  settingsLink: '設定画面',
  settingsNote2: 'から行えます。',
  permissionsNote: '初回の録音時に「マイク」と「オーディオ録音」の許可を求められます。どちらも許可してください。'
}

const en: typeof ja = {
  title: 'Getting Started',
  lead: 'Records meeting audio and does transcription, speaker identification, and summarization entirely on this Mac. Neither audio nor text is sent anywhere else.',
  step1Title: 'Choose a Save Location',
  step1Description: 'Where recordings, transcripts, and summaries are saved. Setting this lets you start recording.',
  unset: 'Not set',
  choose: 'Choose',
  change: 'Change',
  modelsSectionTitle: 'Get Models',
  modelsLead1: 'Downloads the models used for transcription and summarization — about 5.7GB in total, which can take a while depending on your connection. If interrupted, it resumes from where it left off.',
  modelsLeadStrong: 'You can start recording even without the models',
  modelsLead2: ', so you can record a meeting first and process it later.',
  settingsNote1: 'Detailed settings, and specifying models you already have, are available from',
  settingsLink: 'Settings',
  settingsNote2: '.',
  permissionsNote: 'You’ll be asked to allow “Microphone” and “System Audio Recording” the first time you record. Allow both.'
}

/** 初回起動の案内（OnboardingView）の文言。 */
export const onboardingText = localized({ ja, en })
