#!/usr/bin/env bash
# 配布用に whisper-cli をビルドして resources/bin へ配置する。
#
# whisper.cpp は macOS 向けの CLI バイナリを配布していない（リリース資産は
# xcframework と Linux/Windows 版のみ）。配布したアプリの利用者に Homebrew を
# 求めないため、パッケージ作成時にここでビルドして同梱する。
set -euo pipefail

WHISPER_VERSION="${WHISPER_VERSION:-v1.9.4}"
BUILD_DIR="${TMPDIR:-/tmp}/omr-whisper-build"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/resources/bin"

source "$(dirname "$0")/min-macos.sh"

# Core ML を含まない古いビルドが残っていると、エンコーダを取得しても黙って
# Metal のまま動いてしまう。リンク先を見て作り直しが要るかを判断する。
# 最低対応 OS が違うもの（対象 OS を指定する前のビルド）も作り直す。
if [ -x "$OUT_DIR/whisper-cli" ] && [ "${FORCE:-0}" != "1" ]; then
  if otool -L "$OUT_DIR/whisper-cli" | grep -q CoreML && built_for_min_macos "$OUT_DIR/whisper-cli"; then
    echo "[build-whisper] resources/bin/whisper-cli は既にあります（FORCE=1 で再ビルド）。"
    exit 0
  fi
  echo "[build-whisper] 既存のバイナリが Core ML 無し、または最低対応 OS が違うため作り直します。"
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

# Core ML はエンコーダを Neural Engine で動かす。実測で encode が 914ms/回から
# 459ms/回へ落ち、文字起こし全体で約 1.4 倍速くなる（メモリ使用量は変わらない）。
# ALLOW_FALLBACK は必須。エンコーダ（1.2GB・任意ダウンロード）を持たない利用者は
# 従来どおり Metal だけで動く必要がある。
echo "[build-whisper] Metal / Core ML 有効でビルドしています..."
cmake -S "$BUILD_DIR" -B "$BUILD_DIR/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$MIN_MACOS" \
  -DGGML_METAL=ON \
  -DWHISPER_COREML=ON \
  -DWHISPER_COREML_ALLOW_FALLBACK=ON \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DBUILD_SHARED_LIBS=OFF   # 依存ライブラリを埋め込み、単体で動くバイナリにする

cmake --build "$BUILD_DIR/build" --config Release --target whisper-cli -j "$(sysctl -n hw.ncpu)"

mkdir -p "$OUT_DIR"
cp "$BUILD_DIR/build/bin/whisper-cli" "$OUT_DIR/whisper-cli"
chmod +x "$OUT_DIR/whisper-cli"

# ggml-metal.metal は運ばない。Metal のシェーダはライブラリへ埋め込まれており、
# v1.9.4（ggml-org/whisper.cpp#4051）でビルド成果物からも消えた。
# 古いビルドの残骸が resources/bin にあると同梱物に紛れ込むので消しておく。
rm -f "$OUT_DIR/ggml-metal.metal"

rm -rf "$BUILD_DIR"

echo "[build-whisper] 完了: $OUT_DIR/whisper-cli"
"$OUT_DIR/whisper-cli" --help >/dev/null 2>&1 && echo "[build-whisper] 動作確認 OK"
