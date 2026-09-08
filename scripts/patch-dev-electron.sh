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

APP="node_modules/electron/dist/Electron.app"
PLIST="$APP/Contents/Info.plist"

if [ ! -f "$PLIST" ]; then
  echo "[patch-dev-electron] $PLIST が見つかりません。スキップします。"
  exit 0
fi

set_string() {
  /usr/libexec/PlistBuddy -c "Set :$1 $2" "$PLIST" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$PLIST"
}

set_string NSMicrophoneUsageDescription "会議中のあなたの発言を録音するためにマイクを使用します。"
set_string NSAudioCaptureUsageDescription "会議相手の音声を録音するためにシステム音声を取得します。"

# TCC は署名の identifier ごとに権限を記録するため、Info.plist 変更後は必ず再署名する。
codesign --force --sign - --timestamp=none "$APP" >/dev/null 2>&1 \
  || echo "[patch-dev-electron] 再署名に失敗しました（権限プロンプトが出ない場合は手動で codesign してください）"

echo "[patch-dev-electron] Electron.app に音声キャプチャ用の Info.plist キーを適用しました。"
