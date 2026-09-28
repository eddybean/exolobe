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

# 開始忘れの見張りに使う micwatch。同梱物なので Homebrew では入らない。
# 無くてもアプリは動くが、開発中に機能を確認できなくなる。
bash "$(dirname "$0")/build-micwatch.sh"

# カレンダー連携に使う calendarevents。micwatch と同じく同梱物で、無ければ連携だけ無効になる。
bash "$(dirname "$0")/build-calendarevents.sh"

# Apple Intelligence での要約に使う applelm。無ければ要約のモデルに Apple Intelligence を選べないだけ。
bash "$(dirname "$0")/build-applelm.sh"

echo
echo "[setup] 完了しました。'npm run dev' でアプリを起動できます。"
echo "[setup] モデル（文字起こし・要約）はアプリの初期設定画面からダウンロードできます。"
echo
# Homebrew の whisper-cpp は Core ML 無しでビルドされている。配布版は
# build-whisper.sh が Core ML 有効で作るため、開発中だけ挙動が食い違う。
echo "[setup] 注意: Homebrew の whisper-cli は Core ML 無しのため、任意の高速化"
echo "[setup]       （Neural Engine）は効きません。手元で試すには 'npm run build:whisper'"
echo "[setup]       でビルドし、設定画面でそのパスを指定してください。"
