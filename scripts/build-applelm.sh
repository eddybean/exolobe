#!/usr/bin/env bash
# Apple Intelligence での要約に使う applelm をビルドして resources/bin へ配置する。
#
# FoundationModels は Swift からしか呼べない。micwatch と同じく、ここでビルドしたものを
# アプリに同梱する（ADR-046）。macOS 27 SDK が要る（ADR-045）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/resources/bin"
SOURCE="$ROOT/native/applelm/main.swift"

source "$ROOT/scripts/min-macos.sh"

if [ -x "$OUT_DIR/applelm" ] && built_for_min_macos "$OUT_DIR/applelm" && [ "${FORCE:-0}" != "1" ]; then
  echo "[build-applelm] resources/bin/applelm は既にあります（FORCE=1 で再ビルド）。"
  exit 0
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "エラー: swiftc が必要です。'xcode-select --install' を実行してください。" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
echo "[build-applelm] ビルドしています..."
# FoundationModels は macOS 26 からしか無い。強いリンクのままだと最低対応 OS（14.2〜25）で
# 起動すらできないので弱リンクにし、実行時に #available で分ける。
# arm64 固定なのは配布物が Apple Silicon 向けだけだから（release.yml）。
swiftc -O -target "arm64-apple-macos${MIN_MACOS}" \
  -Xlinker -weak_framework -Xlinker FoundationModels \
  -o "$OUT_DIR/applelm" "$SOURCE"
chmod +x "$OUT_DIR/applelm"

echo "[build-applelm] 完了: $OUT_DIR/applelm"
