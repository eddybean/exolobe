/**
 * 設定画面の項目（左のナビ）。
 *
 * 1 本の縦長のページでは、保存先のような基本の項目と、しきい値やプロンプトのような
 * 細かい項目が同列に並び、目当ての設定まで遠かった。項目ごとに分け、よく触る順に並べる。
 */
export const SETTINGS_SECTIONS = [
  { id: 'recording', label: '録音' },
  { id: 'transcription', label: '文字起こし' },
  { id: 'diarization', label: '話者識別' },
  { id: 'summarization', label: '要約' },
  { id: 'search', label: '意味検索' },
  { id: 'models', label: 'モデル' },
  { id: 'storage', label: '保存先と音声' },
  { id: 'about', label: 'このアプリについて' }
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

/**
 * 設定画面を開いたときの項目。
 *
 * 保存先が未設定なら何より先に保存先を見せる（決めないと録音できない。初期設定の
 * 途中で設定画面へ来た人は、まずここで迷う）。そうでなければ前回の項目を続ける。
 */
export const initialSettingsSection = (params: {
  storageDir: string | null
  previous: SettingsSectionId | undefined
}): SettingsSectionId => {
  if (params.storageDir === null) return 'storage'
  return params.previous ?? 'recording'
}
