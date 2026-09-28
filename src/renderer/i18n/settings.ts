import { localized } from './locale'

const ja = {
  nav: {
    ariaLabel: '設定の項目'
  },
  saved: '保存しました',
  common: {
    unset: '未設定',
    choose: '選択',
    change: '変更'
  },
  recording: {
    cardTitle: '録音の操作と知らせ',
    silenceAlertLabel: '無音が続いたら知らせる',
    silenceAlertHint: '会議が終わっているのに録音が続いている状態を防ぎます。自動では停止しません。',
    silenceDurationLabel: '知らせるまでの無音時間（分）',
    silenceDurationHint: '1 分以上を指定してください。',
    globalShortcutLabel: (shortcut: string) => `${shortcut} でどこからでも録音を開始・停止する`,
    globalShortcutHint:
      '他のアプリを見ていても録音を始め・止められます。同じキーを使うアプリとぶつかる場合は切ってください。',
    startAlertLabel: 'マイクが使われていたら録音を促す',
    startAlertHint:
      '他のアプリがマイクを使い続けているとき、録音の開始忘れを知らせます。自動では開始しません（会議の予定での自動開始は、下のカレンダー連携で選べます）。',
    startAlertDelayLabel: '録音を促すまでの時間（分）',
    startAlertDelayHint: '0.5 分（30 秒）以上を指定してください。'
  },
  transcription: {
    methodCardTitle: '文字起こしの方法',
    languageLabel: '言語',
    languageOptionJa: '日本語',
    languageOptionEn: '英語',
    languageOptionAuto: '自動判定',
    glossaryLabel: '用語集',
    glossaryHint:
      '1 行に 1 語。社名・製品名・人名・略語を登録しておくと、音の近い一般語に化けるのを防げます。多すぎると入り切らない分が無視されるので、間違えやすい語に絞ってください。',
    vadLabel: '無音区間を文字起こししない',
    vadHint:
      '喋っていない時間を whisper に渡しません。無効にすると、無音から「ご視聴ありがとうございました」のような文が生まれることがあります。無音検出モデルが未取得のときは自動的に無効になります。',
    modelCardTitle: 'モデルとプログラム',
    whisperModelLabel: 'whisper モデル',
    whisperModelHint: 'ggml 形式（.bin）のモデルを指定します。',
    vadModelLabel: '無音検出モデル',
    vadModelHint: 'whisper.cpp 向けの ggml 形式 Silero VAD（.bin）。',
    binaryPathLabel: 'whisper-cli のパス',
    binaryPathHint: 'Homebrew で入れた場合は whisper-cli のままで動きます。'
  },
  diarization: {
    speakerCardTitle: '話者の分け方',
    enabledLabel: '参加者を複数人に分ける',
    enabledHint: '無効でも「自分／参加者」の 2 話者には常に分かれます。',
    maxSpeakersLabel: '話者数の上限',
    clusteringThresholdLabel: '同じ人とみなす声の近さ',
    clusteringThresholdHint:
      '1 つの録音の中で話者を分ける基準です。同じ人が別々の話者に割れるときは上げ、別人が 1 人にまとまるときは下げてください（既定 0.5）。',
    namingCardTitle: '声で名前を当てる',
    voiceprintThresholdLabel: '声の一致とみなす近さ',
    voiceprintThresholdHint:
      '覚えた声と比べて、この値を超えたら名前を自動で入れます。上げるほど慎重になり（名前が入りにくくなり）、下げるほど別人に当たりやすくなります。',
    modelCardTitle: 'モデル',
    segmentationModelLabel: 'セグメンテーションモデル',
    segmentationModelHint: 'sherpa-onnx の pyannote 系 .onnx。',
    embeddingModelLabel: '話者埋め込みモデル',
    embeddingModelHint: 'sherpa-onnx の speaker embedding .onnx。'
  },
  summarization: {
    styleCardTitle: '要約の作り方',
    promptModeLabel: '使うプロンプト',
    promptModeDefault: 'アプリの既定',
    promptModeCustom: 'カスタム',
    promptModeHint:
      'アプリの既定は会議の言語に合わせて切り替わり、アプリの更新で改善されたときも自動で反映されます。',
    promptLabel: '要約プロンプト',
    promptHint:
      '{{transcript}} の位置に文字起こしが、{{notes}} の位置に録音中のメモと印が差し込まれます（{{notes}} が無ければ末尾に付きます）。',
    promptDefaultHint: '既定のプロンプトは編集できません。書き換えるときは「カスタム」を選びます。',
    contextSizeLabel: 'コンテキスト長',
    contextSizeHint: '長い会議ほど大きい方が有利ですが、メモリを多く使います。',
    modelCardTitle: 'モデルとメモリ',
    providerLabel: '要約に使うモデル',
    providerHint:
      'Gemma はこのアプリの中で動かします。Apple Intelligence は macOS に組み込まれたモデルで、ダウンロードが要りません。30 分ほどの会議なら数倍速く終わりますが、1 時間を超える会議では細かく分けて順に要約するため、かえって遅くなります。',
    providerLlama: 'Gemma（精度重視・おすすめ）',
    providerApple: 'Apple Intelligence（速さ重視）',
    appleWarning:
      'Apple Intelligence の要約は Gemma より精度が劣ります。決定事項と ToDo を混ぜたり、ToDo の期限を取り違えたりしやすくなります。1 時間を超える会議では、要約というより話題の箇条書きを並べたものになりがちです。チャットには引き続き Gemma を使います。',
    modelLabel: '要約モデル',
    modelHint: 'GGUF 形式のモデルを指定します（既定: Gemma 4 E4B QAT q4_0）。',
    memoryProtectionLabel: 'メモリ保護',
    memoryProtectionHint:
      '空きメモリが足りないとき、文字起こしと要約を実行せず失敗として記録します。音声とエンコードは残るので、他のアプリを閉じてから詳細画面で再実行できます。',
    memoryProtectionConservative: '保守的（OS に多く空ける）',
    memoryProtectionStandard: '標準',
    memoryProtectionOff: 'オフ（確認せず実行する）'
  },
  models: {
    lead: 'アプリが管理するモデルです。ダウンロードすると保存場所が自動で設定されます。'
  },
  storage: {
    cardTitle: '保存先',
    label: '保存先',
    hint: '録音・文字起こし・要約の保存場所です。',
    audioCardTitle: '音声の保存形式',
    sampleRateLabel: 'サンプルレート',
    sampleRateHint: 'whisper は 16000Hz を前提としています。',
    codecLabel: 'コーデック',
    codecHint: 'HE-AAC はさらに小さくなりますが 8kHz に落ちるため、会議音声では AAC-LC を推奨します。',
    codecAac: 'AAC-LC（推奨）',
    codecHeAac: 'HE-AAC（最小サイズ）',
    bitrateLabel: 'ビットレート',
    bitrateHint: '32kbps で 1 時間あたり約 14MB です。'
  },
  appearance: {
    label: 'テーマ',
    hint: '「OS の設定に合わせる」では、macOS の外観の切り替えに追従します。',
    system: 'OS の設定に合わせる',
    light: 'ライト',
    dark: 'ダーク'
  },
  sections: {
    recording: '録音',
    transcription: '文字起こし',
    diarization: '話者識別',
    summarization: '要約',
    search: '意味検索',
    models: 'モデル',
    storage: '保存先と音声',
    appearance: '外観',
    about: 'このアプリについて'
  }
}

const en: typeof ja = {
  nav: {
    ariaLabel: 'Settings sections'
  },
  saved: 'Saved',
  common: {
    unset: 'Not set',
    choose: 'Choose',
    change: 'Change'
  },
  recording: {
    cardTitle: 'Recording controls and alerts',
    silenceAlertLabel: 'Alert when silence continues',
    silenceAlertHint:
      'Prevents recording from continuing after the meeting has ended. Recording does not stop automatically.',
    silenceDurationLabel: 'Silence duration before alerting (minutes)',
    silenceDurationHint: 'Enter 1 minute or more.',
    globalShortcutLabel: (shortcut: string) => `Start and stop recording from anywhere with ${shortcut}`,
    globalShortcutHint:
      'Start or stop recording even while looking at another app. Turn this off if the shortcut conflicts with another app.',
    startAlertLabel: 'Prompt to record when the microphone is in use',
    startAlertHint:
      'Lets you know if another app keeps using the microphone, in case you forgot to start recording. This does not start recording automatically (automatic start for calendar events can be set below, under Calendar Integration).',
    startAlertDelayLabel: 'Time before prompting to record (minutes)',
    startAlertDelayHint: 'Enter 0.5 minutes (30 seconds) or more.'
  },
  transcription: {
    methodCardTitle: 'Transcription method',
    languageLabel: 'Language',
    languageOptionJa: 'Japanese',
    languageOptionEn: 'English',
    languageOptionAuto: 'Detect automatically',
    glossaryLabel: 'Glossary',
    glossaryHint:
      'One term per line. Registering company names, product names, personal names, and abbreviations keeps them from turning into similar-sounding common words. Keep the list to easily confused terms — extras beyond what fits are ignored.',
    vadLabel: 'Skip silent stretches when transcribing',
    vadHint:
      'Keeps silent stretches from being passed to whisper. Turning this off can let silence turn into made-up sentences like “Thanks for watching.” This is disabled automatically when the voice activity detection model has not been downloaded.',
    modelCardTitle: 'Model and program',
    whisperModelLabel: 'whisper model',
    whisperModelHint: 'Specify a model in ggml format (.bin).',
    vadModelLabel: 'Voice activity detection model',
    vadModelHint: 'A ggml-format Silero VAD (.bin) for whisper.cpp.',
    binaryPathLabel: 'whisper-cli path',
    binaryPathHint: 'If installed via Homebrew, leaving this as whisper-cli works.'
  },
  diarization: {
    speakerCardTitle: 'How speakers are split',
    enabledLabel: 'Split participants into individual speakers',
    enabledHint: 'Even when off, recordings are always split into 2 speakers: you and participants.',
    maxSpeakersLabel: 'Maximum number of speakers',
    clusteringThresholdLabel: 'Voice closeness treated as the same person',
    clusteringThresholdHint:
      'The threshold used to split speakers within a single recording. Raise it if the same person gets split into separate speakers, and lower it if different people get merged into one (default 0.5).',
    namingCardTitle: 'Naming speakers by voice',
    voiceprintThresholdLabel: 'Closeness treated as a voice match',
    voiceprintThresholdHint:
      'Names are applied automatically when a voice exceeds this closeness to a learned voice. Raising it makes matching more cautious (names get applied less often); lowering it makes mismatches with other people more likely.',
    modelCardTitle: 'Models',
    segmentationModelLabel: 'Segmentation model',
    segmentationModelHint: 'A pyannote-based .onnx model for sherpa-onnx.',
    embeddingModelLabel: 'Speaker embedding model',
    embeddingModelHint: 'A speaker embedding .onnx model for sherpa-onnx.'
  },
  summarization: {
    styleCardTitle: 'How summaries are made',
    promptModeLabel: 'Prompt to use',
    promptModeDefault: 'App default',
    promptModeCustom: 'Custom',
    promptModeHint:
      'The app default follows the meeting language and picks up improvements when the app is updated.',
    promptLabel: 'Summary prompt',
    promptHint:
      'The transcript is inserted at {{transcript}}, and notes and bookmarks taken during recording are inserted at {{notes}} (appended at the end if {{notes}} is absent).',
    promptDefaultHint: 'The default prompt cannot be edited. Choose "Custom" to write your own.',
    contextSizeLabel: 'Context length',
    contextSizeHint: 'Longer meetings benefit from a larger value, but it uses more memory.',
    modelCardTitle: 'Model and memory',
    providerLabel: 'Model used for summaries',
    providerHint:
      'Gemma runs inside this app. Apple Intelligence is the model built into macOS, so there is nothing to download. It finishes several times faster for meetings of about 30 minutes, but meetings over an hour are summarized in small pieces one after another, which makes it slower.',
    providerLlama: 'Gemma (more accurate, recommended)',
    providerApple: 'Apple Intelligence (faster)',
    appleWarning:
      'Summaries from Apple Intelligence are less accurate than Gemma’s. They tend to mix decisions with to-dos and get to-do due dates wrong. For meetings over an hour, the result tends to be a list of topic bullets rather than a summary. Chat still uses Gemma.',
    modelLabel: 'Summarization model',
    modelHint: 'Specify a model in GGUF format (default: Gemma 4 E4B QAT q4_0).',
    memoryProtectionLabel: 'Memory protection',
    memoryProtectionHint:
      'When free memory is insufficient, transcription and summarization are recorded as failed instead of running. Audio and encoding are unaffected, so you can close other apps and run them again from the detail view.',
    memoryProtectionConservative: 'Conservative (leaves more free for the OS)',
    memoryProtectionStandard: 'Standard',
    memoryProtectionOff: 'Off (run without checking)'
  },
  models: {
    lead: 'Models managed by the app. The save location is set automatically when you download one.'
  },
  storage: {
    cardTitle: 'Save location',
    label: 'Save location',
    hint: 'Where recordings, transcripts, and summaries are saved.',
    audioCardTitle: 'Audio save format',
    sampleRateLabel: 'Sample rate',
    sampleRateHint: 'whisper assumes 16000Hz.',
    codecLabel: 'Codec',
    codecHint:
      'HE-AAC produces smaller files but drops to 8kHz, so AAC-LC is recommended for meeting audio.',
    codecAac: 'AAC-LC (recommended)',
    codecHeAac: 'HE-AAC (smallest size)',
    bitrateLabel: 'Bit rate',
    bitrateHint: 'At 32kbps, about 14MB per hour.'
  },
  appearance: {
    label: 'Theme',
    hint: 'Match System follows the macOS appearance setting as it changes.',
    system: 'Match System',
    light: 'Light',
    dark: 'Dark'
  },
  sections: {
    recording: 'Recording',
    transcription: 'Transcription',
    diarization: 'Speaker Identification',
    summarization: 'Summary',
    search: 'Semantic Search',
    models: 'Models',
    storage: 'Save Location & Audio',
    appearance: 'Appearance',
    about: 'About'
  }
}

/** 設定画面（SettingsView / settingsSections）の文言。 */
export const settingsText = localized({ ja, en })
