#!/usr/bin/env bash
# 開始忘れの見張りに使う micwatch をビルドして resources/bin へ配置する。
#
# 「他のアプリがマイクを使っているか」は CoreAudio でしか読めず、Electron からは
# 触れない。whisper-cli と同じく、ここでビルドしたものをアプリに同梱する。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/resources/bin"
SOURCE="$ROOT/native/micwatch/main.swift"

source "$ROOT/scripts/min-macos.sh"

if [ -x "$OUT_DIR/micwatch" ] && built_for_min_macos "$OUT_DIR/micwatch" && [ "${FORCE:-0}" != "1" ]; then
  echo "[build-micwatch] resources/bin/micwatch は既にあります（FORCE=1 で再ビルド）。"
  exit 0
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "エラー: swiftc が必要です。'xcode-select --install' を実行してください。" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
echo "[build-micwatch] ビルドしています..."
# arm64 固定なのは配布物が Apple Silicon 向けだけだから（release.yml）。
swiftc -O -target "arm64-apple-macos$MIN_MACOS" -framework CoreAudio -o "$OUT_DIR/micwatch" "$SOURCE"
chmod +x "$OUT_DIR/micwatch"

echo "[build-micwatch] 完了: $OUT_DIR/micwatch"
