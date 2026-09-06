#!/usr/bin/env bash
# 開発環境の準備。
#
# 配布版のアプリは whisper-cli を同梱し、モデルは初回起動時にアプリ内で
# ダウンロードするため、利用者がこのスクリプトを実行する必要はない。
# 開発中に手元で動かすための近道として用意している。
set -euo pipefail

require_macos_version() {
  local version major minor
  version="$(sw_vers -productVersion)"
  major="$(echo "$version" | cut -d. -f1)"
  minor="$(echo "$version" | cut -d. -f2)"

  if [ "$major" -lt 14 ] || { [ "$major" -eq 14 ] && [ "${minor:-0}" -lt 2 ]; }; then
    echo "エラー: Core Audio Process Tap には macOS 14.2 以上が必要です（現在: ${version}）" >&2
    exit 1
  fi
}

install_whisper() {
  if command -v whisper-cli >/dev/null 2>&1; then
    echo "[setup] whisper-cli は導入済みです。"
    return
  fi

  if ! command -v brew >/dev/null 2>&1; then
    echo "エラー: Homebrew が見つかりません。https://brew.sh からインストールするか、" >&2
    echo "       'npm run build:whisper' で whisper.cpp をソースからビルドしてください。" >&2
    exit 1
  fi

  echo "[setup] whisper-cpp をインストールしています..."
  brew install whisper-cpp
}

require_macos_version
install_whisper

echo
echo "[setup] 完了しました。'npm run dev' でアプリを起動できます。"
echo "[setup] モデル（文字起こし・要約）はアプリの初期設定画面からダウンロードできます。"
