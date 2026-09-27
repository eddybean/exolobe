#!/usr/bin/env bash
# 旧名 Duoscribe の userData を Exolobe へ移す。改名前の版を使っていた Mac で一度だけ実行する。
#
# アプリ名が変わると Electron の userData（~/Library/Application Support/<アプリ名>）も変わり、
# 設定・モデル・声紋帳が旧ディレクトリに取り残される。声紋帳（voiceprints.json）は
# 再生成できない（ADR-031）ので、コピーではなく丸ごと移して取り違えを防ぐ。
# 録音そのものは設定の保存先にあり、ここでは動かさない。
#
# 使い方: bash scripts/migrate-from-duoscribe.sh
set -euo pipefail

APP_SUPPORT="$HOME/Library/Application Support"
LEGACY="$APP_SUPPORT/Duoscribe"
CURRENT="$APP_SUPPORT/Exolobe"

if [[ ! -d "$LEGACY" ]]; then
  echo "移行するものはありません（$LEGACY がありません）。"
  exit 0
fi

# 動いているアプリが書き込みの途中だと、移した後に旧ディレクトリが作り直される。
if pgrep -x Duoscribe >/dev/null || pgrep -x Exolobe >/dev/null; then
  echo "Duoscribe / Exolobe を終了してから実行してください。" >&2
  exit 1
fi

# 両方あるときに片方を選ぶと、もう片方の設定や声紋を黙って捨てることになる。判断は利用者に任せる。
if [[ -e "$CURRENT" ]]; then
  echo "移行先の $CURRENT が既にあります。中身を確かめ、不要なら消してから再実行してください。" >&2
  exit 1
fi

mv "$LEGACY" "$CURRENT"
echo "移しました: $LEGACY → $CURRENT"
