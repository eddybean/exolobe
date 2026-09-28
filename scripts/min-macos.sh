#!/usr/bin/env bash
# 同梱バイナリの最低対応 OS をそろえるための共通部分。build-*.sh から source する。
#
# swiftc も clang も、対象 OS を指定しなければビルドした機械の OS を最低対応 OS にする。
# CI のランナーを上げただけで、同梱の whisper-cli などが新しい macOS でしか起動しなくなる。
# 値はアプリの宣言（electron-builder.yml の LSMinimumSystemVersion）から読み、二重に持たない。

_MIN_MACOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MIN_MACOS="$(sed -n "s/^[[:space:]]*LSMinimumSystemVersion:[[:space:]]*'\{0,1\}\([0-9.]*\)'\{0,1\}.*/\1/p" \
  "$_MIN_MACOS_ROOT/electron-builder.yml")"
if [ -z "$MIN_MACOS" ]; then
  echo "エラー: electron-builder.yml から LSMinimumSystemVersion を読めません。" >&2
  exit 1
fi
export MIN_MACOS

# Mach-O の最低対応 OS（LC_BUILD_VERSION の minos）を出す。読めなければ空。
binary_minos() {
  otool -l "$1" 2>/dev/null | awk '/LC_BUILD_VERSION/ { found = 1 } found && $1 == "minos" { print $2; exit }'
}

# 既にあるバイナリを使い回してよいか。違う最低対応 OS で作られたものは作り直す。
built_for_min_macos() {
  [ "$(binary_minos "$1")" = "$MIN_MACOS" ]
}
