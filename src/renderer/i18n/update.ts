import { localized } from './locale'

/** 新しい版の通知（ナビの知らせと、設定の「このアプリについて」）の文言。 */

const ja = {
  navBadge: (version: string) => `新しい版 ${version}`,
  navBadgeTitle: '新しい版が出ています。更新の方法を見る',
  cardTitle: '更新',
  currentVersion: (version: string) => `いまの版: ${version}`,
  intervalLabel: '新しい版を確認する',
  intervalHint:
    '確認のときに GitHub へ届くのは、IP アドレスとアプリの名前・版（User-Agent）だけです。録音や文字起こしは送りません。アプリが自分で更新を入れることはありません。',
  intervals: {
    daily: '毎日',
    weekly: '毎週',
    monthly: '毎月',
    never: '確認しない'
  },
  checkNow: '今すぐ確認',
  checking: '確認しています…',
  upToDate: (checkedAt: string) => `最新の版です（最終確認: ${checkedAt}）`,
  unchecked: 'まだ確認していません。',
  manualOnly: '自動では確認しません。「今すぐ確認」で確かめられます。',
  available: (version: string) => `新しい版 ${version} が出ています。`,
  homebrewHint: 'Homebrew で入れた版です。ターミナルで次を実行してください。',
  copyCommand: '更新のコマンドをコピー',
  downloadHint: '配布ページから DMG をダウンロードし、アプリを入れ替えてください。録音やモデルはそのまま残ります。',
  openPage: '配布ページを開く'
}

const en: typeof ja = {
  navBadge: (version: string) => `Update ${version}`,
  navBadgeTitle: 'A new version is available. See how to update',
  cardTitle: 'Updates',
  currentVersion: (version: string) => `Current version: ${version}`,
  intervalLabel: 'Check for new versions',
  intervalHint:
    'A check sends GitHub only your IP address and the app name and version (User-Agent). Recordings and transcripts are never sent. The app never installs updates by itself.',
  intervals: {
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    never: 'Never'
  },
  checkNow: 'Check Now',
  checking: 'Checking…',
  upToDate: (checkedAt: string) => `You're up to date (last checked ${checkedAt}).`,
  unchecked: 'Not checked yet.',
  manualOnly: 'Automatic checks are off. Use Check Now to check.',
  available: (version: string) => `Version ${version} is available.`,
  homebrewHint: 'This copy was installed with Homebrew. Run the following in Terminal.',
  copyCommand: 'Copy the update command',
  downloadHint:
    'Download the DMG from the release page and replace the app. Your recordings and models stay in place.',
  openPage: 'Open Release Page'
}

export const updateText = localized({ ja, en })
