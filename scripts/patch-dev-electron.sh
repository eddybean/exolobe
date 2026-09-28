#!/usr/bin/env bash
# 開発用 Electron.app に音声キャプチャ関連の Info.plist キーを注入し ad-hoc 再署名する。
#
# `electron-vite dev` は node_modules/electron/dist/Electron.app を起動するため、
# そのままでは NSAudioCaptureUsageDescription / NSMicrophoneUsageDescription が無く、
# Core Audio Process Tap の権限プロンプトが表示されない（Tap の作成自体が失敗する）。
# npm postinstall から実行され、Electron を入れ直すたびに再適用される。
#
# Electron 44 以降は npm の postinstall でバイナリを自動取得しなくなったため、
# package.json の postinstall で先に `install-electron` を実行してから本スクリプトを呼ぶ。
set -euo pipefail

# OMR_DEV_ELECTRON_APP はテスト用（tests/scripts/info-plist-strings.test.ts）。
APP="${OMR_DEV_ELECTRON_APP:-node_modules/electron/dist/Electron.app}"
PLIST="$APP/Contents/Info.plist"
# 説明文は配布版と同じ build/lproj の InfoPlist.strings から取る（ADR-043）。
# ここに文言を書き写すと、配布版と開発版で食い違っても気づけない。
LPROJ="$(cd "$(dirname "$0")/.." && pwd)/build/lproj"

if [ ! -f "$PLIST" ]; then
  echo "[patch-dev-electron] $PLIST が見つかりません。スキップします。"
  exit 0
fi

set_string() {
  /usr/libexec/PlistBuddy -c "Set :$1 $2" "$PLIST" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$PLIST"
}

english() {
  plutil -extract "$1" raw -o - "$LPROJ/en.lproj/InfoPlist.strings"
}

# 基底は英語（配布版の CFBundleDevelopmentRegion と同じ）。言語ごとの文言は .lproj から引かれる。
set_string NSMicrophoneUsageDescription "$(english NSMicrophoneUsageDescription)"
set_string NSAudioCaptureUsageDescription "$(english NSAudioCaptureUsageDescription)"
# カレンダー連携（ADR-040）。説明文が無いまま EventKit の許可を求めると、TCC がプロセスを落とす。
set_string NSCalendarsFullAccessUsageDescription "$(english NSCalendarsFullAccessUsageDescription)"

for dir in "$LPROJ"/*.lproj; do
  mkdir -p "$APP/Contents/Resources/$(basename "$dir")"
  cp "$dir/InfoPlist.strings" "$APP/Contents/Resources/$(basename "$dir")/InfoPlist.strings"
done

# TCC は署名の identifier ごとに権限を記録するため、Info.plist 変更後は必ず再署名する。
codesign --force --sign - --timestamp=none "$APP" >/dev/null 2>&1 \
  || echo "[patch-dev-electron] 再署名に失敗しました（権限プロンプトが出ない場合は手動で codesign してください）"

echo "[patch-dev-electron] Electron.app に権限の説明文（音声キャプチャ・カレンダー）を適用しました。"
