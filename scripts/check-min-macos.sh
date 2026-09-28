#!/usr/bin/env bash
# 同梱バイナリが、アプリの宣言する最低対応 OS で起動できるかを確かめる。
#
# 最低対応 OS より新しい OS 向けに作られたバイナリは、古い OS では起動すらしない。
# アプリ自体は起動し、文字起こしなどが失敗して初めて気付くので、配布前に止める。
#
# 使い方: bash scripts/check-min-macos.sh <バイナリ>...
set -euo pipefail

source "$(dirname "$0")/min-macos.sh"

# ドット区切りの版を比べる（a <= b なら真）。
version_le() {
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$1" ]
}

# 変数は ${} で囲む。macOS の /bin/bash は UTF-8 ロケール（CI は en_US.UTF-8）だと全角括弧の先頭バイトを
# 変数名の続きと読み、"$minos（" が未定義の変数になって set -u で落ちる。C ロケールでは起きない。
failed=0
for bin in "$@"; do
  minos="$(binary_minos "$bin")"
  if [ -z "$minos" ]; then
    echo "::error::$bin の最低対応 OS を読めません"
    failed=1
  elif version_le "$minos" "$MIN_MACOS"; then
    echo "${bin}: minos ${minos}（アプリの最低対応 OS は ${MIN_MACOS}）"
  else
    echo "::error::${bin} は macOS ${minos} 以降向けです（アプリの最低対応 OS は ${MIN_MACOS}）"
    failed=1
  fi
done
exit "$failed"
