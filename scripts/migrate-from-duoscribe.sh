#!/usr/bin/env bash
# 旧名 Duoscribe の userData を Exolobe へ移す。改名前の版を使っていた Mac で実行する。
#
# アプリ名が変わると Electron の userData（~/Library/Application Support/<アプリ名>）も変わり、
# 設定・数 GB のモデル・意味検索の索引が旧ディレクトリに取り残される。コピーではなく丸ごと移し、
# 2 か所に同じものが残って、どちらが使われているのか分からなくなるのを防ぐ。
# 録音と声紋帳（voiceprints.json）は設定の保存先にあり、ここでは動かさない。
#
# 移した後、settings.json の中の旧ディレクトリを指すパスを書き換える。モデルの場所は
# 設定画面で任意に選べるためフルパスで保存されており、移しただけではどのモデルも未取得に見える。
# 何度実行しても結果は同じなので、移動だけ済んだ Mac で再実行してもよい。
#
# 使い方: bash scripts/migrate-from-duoscribe.sh
set -euo pipefail

APP_SUPPORT="$HOME/Library/Application Support"
LEGACY="$APP_SUPPORT/Duoscribe"
CURRENT="$APP_SUPPORT/Exolobe"
SETTINGS="$CURRENT/settings.json"

# 動いているアプリが書き込みの途中だと、移した後に旧ディレクトリが作り直されたり、
# 書き換えた設定を古い内容で上書きされたりする。
if pgrep -x Duoscribe >/dev/null || pgrep -x Exolobe >/dev/null; then
  echo "Duoscribe / Exolobe を終了してから実行してください。" >&2
  exit 1
fi

if [[ -d "$LEGACY" ]]; then
  # 両方あるときに片方を選ぶと、もう片方の設定を黙って捨てることになる。判断は利用者に任せる。
  if [[ -e "$CURRENT" ]]; then
    echo "移行先の $CURRENT が既にあります。中身を確かめ、不要なら消してから再実行してください。" >&2
    exit 1
  fi
  mv "$LEGACY" "$CURRENT"
  echo "移しました: $LEGACY → $CURRENT"
fi

if [[ ! -f "$SETTINGS" ]]; then
  [[ -d "$CURRENT" ]] || echo "移行するものはありません（$LEGACY がありません）。"
  exit 0
fi

# 旧ディレクトリそのもの、またはその配下を指す文字列だけを置き換える。「Duoscribe-backup」の
# ような名前が同じ文字で始まる別のディレクトリまで巻き込まないよう、直後が / か " であることを見る。
# JSON として読み書きし直さず文字列で置き換えるのは、知らないキーや並びをそのまま残すため（ADR-035）。
if grep -qF "\"$LEGACY" "$SETTINGS"; then
  LEGACY="$LEGACY" CURRENT="$CURRENT" perl -pe 's/"\Q$ENV{LEGACY}\E(?=[\/"])/"$ENV{CURRENT}/g' \
    "$SETTINGS" >"$SETTINGS.tmp"
  mv "$SETTINGS.tmp" "$SETTINGS"
  echo "設定の中のパスを書き換えました: $SETTINGS"
fi
