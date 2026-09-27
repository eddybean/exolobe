#!/usr/bin/env bash
# カレンダー連携に使う calendarevents をビルドして resources/bin へ配置する。
#
# EventKit は Electron からは触れない。micwatch と同じく、ここでビルドしたものを
# アプリに同梱する（ADR-040）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/resources/bin"
SOURCE="$ROOT/native/calendarevents/main.swift"

if [ -x "$OUT_DIR/calendarevents" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "[build-calendarevents] resources/bin/calendarevents は既にあります（FORCE=1 で再ビルド）。"
  exit 0
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "エラー: swiftc が必要です。'xcode-select --install' を実行してください。" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
echo "[build-calendarevents] ビルドしています..."
swiftc -O -framework EventKit -o "$OUT_DIR/calendarevents" "$SOURCE"
chmod +x "$OUT_DIR/calendarevents"

echo "[build-calendarevents] 完了: $OUT_DIR/calendarevents"
