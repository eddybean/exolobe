#!/usr/bin/env bash
# 録音中のライブ字幕に使う livetranscribe をビルドして resources/bin へ配置する。
#
# SpeechAnalyzer は Swift からしか呼べない。applelm と同じく、ここでビルドしたものを
# アプリに同梱する（ADR-050）。macOS 27 SDK が要る（ADR-045）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/resources/bin"
SOURCE="$ROOT/native/livetranscribe/main.swift"

source "$ROOT/scripts/min-macos.sh"

if [ -x "$OUT_DIR/livetranscribe" ] && built_for_min_macos "$OUT_DIR/livetranscribe" && [ "${FORCE:-0}" != "1" ]; then
  echo "[build-livetranscribe] resources/bin/livetranscribe は既にあります（FORCE=1 で再ビルド）。"
  exit 0
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "エラー: swiftc が必要です。'xcode-select --install' を実行してください。" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
echo "[build-livetranscribe] ビルドしています..."
# SpeechAnalyzer は macOS 26 からしか無い。Speech を強いリンクにしても起動はできるが、
# 26 未満のシンボルを引いた時点で落ちるので弱リンクにし、実行時に #available で分ける。
# arm64 固定なのは配布物が Apple Silicon 向けだけだから（release.yml）。
swiftc -O -target "arm64-apple-macos${MIN_MACOS}" \
  -Xlinker -weak_framework -Xlinker Speech \
  -o "$OUT_DIR/livetranscribe" "$SOURCE"
chmod +x "$OUT_DIR/livetranscribe"

echo "[build-livetranscribe] 完了: $OUT_DIR/livetranscribe"
