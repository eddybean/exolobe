#!/usr/bin/env bash
# 配布用に whisper-cli をビルドして resources/bin へ配置する。
#
# whisper.cpp は macOS 向けの CLI バイナリを配布していない（リリース資産は
# xcframework と Linux/Windows 版のみ）。配布したアプリの利用者に Homebrew を
# 求めないため、パッケージ作成時にここでビルドして同梱する。
set -euo pipefail

WHISPER_VERSION="${WHISPER_VERSION:-v1.7.4}"
BUILD_DIR="${TMPDIR:-/tmp}/omr-whisper-build"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/resources/bin"

if [ -x "$OUT_DIR/whisper-cli" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "[build-whisper] resources/bin/whisper-cli は既にあります（FORCE=1 で再ビルド）。"
  exit 0
fi

for tool in git cmake; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "エラー: $tool が必要です。'xcode-select --install' と 'brew install cmake' を実行してください。" >&2
    exit 1
  fi
done

echo "[build-whisper] whisper.cpp ${WHISPER_VERSION} を取得しています..."
rm -rf "$BUILD_DIR"
git clone --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp "$BUILD_DIR"

echo "[build-whisper] Metal 有効でビルドしています..."
cmake -S "$BUILD_DIR" -B "$BUILD_DIR/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_METAL=ON \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DBUILD_SHARED_LIBS=OFF   # 依存ライブラリを埋め込み、単体で動くバイナリにする

cmake --build "$BUILD_DIR/build" --config Release --target whisper-cli -j "$(sysctl -n hw.ncpu)"

mkdir -p "$OUT_DIR"
cp "$BUILD_DIR/build/bin/whisper-cli" "$OUT_DIR/whisper-cli"
chmod +x "$OUT_DIR/whisper-cli"

# Metal のシェーダは実行時に必要になる場合があるため一緒に置く。
if [ -f "$BUILD_DIR/build/bin/ggml-metal.metal" ]; then
  cp "$BUILD_DIR/build/bin/ggml-metal.metal" "$OUT_DIR/"
fi

rm -rf "$BUILD_DIR"

echo "[build-whisper] 完了: $OUT_DIR/whisper-cli"
"$OUT_DIR/whisper-cli" --help >/dev/null 2>&1 && echo "[build-whisper] 動作確認 OK"
