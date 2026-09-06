#!/usr/bin/env bash
# ローカル推論に必要な外部依存を導入する。初回のみ実行すればよい。
#   - whisper.cpp (whisper-cli): 文字起こし
#   - Ollama:                    要約
set -euo pipefail

WHISPER_MODEL_DIR="${HOME}/.cache/online-meeting-recorder/models"
WHISPER_MODEL_FILE="ggml-large-v3-turbo-q5_0.bin"
WHISPER_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}"
OLLAMA_MODEL="qwen3:8b"

require_macos_version() {
  local major
  major="$(sw_vers -productVersion | cut -d. -f1)"
  if [ "$major" -lt 14 ]; then
    echo "エラー: Core Audio Process Tap には macOS 14.2 以上が必要です（現在: $(sw_vers -productVersion)）" >&2
    exit 1
  fi
}

require_brew() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "エラー: Homebrew が見つかりません。https://brew.sh からインストールしてください。" >&2
    exit 1
  fi
}

install_whisper() {
  if command -v whisper-cli >/dev/null 2>&1; then
    echo "[setup] whisper-cli は導入済みです。"
  else
    echo "[setup] whisper-cpp をインストールしています..."
    brew install whisper-cpp
  fi

  mkdir -p "$WHISPER_MODEL_DIR"
  if [ -f "${WHISPER_MODEL_DIR}/${WHISPER_MODEL_FILE}" ]; then
    echo "[setup] whisper モデルは取得済みです。"
  else
    echo "[setup] whisper モデルをダウンロードしています（約 1.1GB）..."
    curl -L --fail --progress-bar -o "${WHISPER_MODEL_DIR}/${WHISPER_MODEL_FILE}" "$WHISPER_MODEL_URL"
  fi
}

install_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    echo "[setup] ollama は導入済みです。"
  else
    echo "[setup] ollama をインストールしています..."
    brew install ollama
    echo "[setup] 'brew services start ollama' でバックグラウンド起動できます。"
  fi

  if ollama list 2>/dev/null | grep -q "^${OLLAMA_MODEL%%:*}"; then
    echo "[setup] 要約モデルは取得済みです。"
  else
    echo "[setup] ollama が起動していれば ${OLLAMA_MODEL} を取得します..."
    ollama pull "$OLLAMA_MODEL" || echo "[setup] 取得に失敗しました。'ollama serve' を起動後に 'ollama pull ${OLLAMA_MODEL}' を実行してください。"
  fi
}

require_macos_version
require_brew
install_whisper
install_ollama

echo
echo "[setup] 完了しました。'npm run dev' でアプリを起動できます。"
echo "[setup] whisper モデル: ${WHISPER_MODEL_DIR}/${WHISPER_MODEL_FILE}"
