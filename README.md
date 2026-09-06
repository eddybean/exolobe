# 会議レコーダー（online-meeting-recorder）

Google Meet / Zoom などの Web 会議を Mac で録音し、**文字起こし・話者識別・要約までを
この Mac の中だけで**行うデスクトップアプリ。音声もテキストも外部には送信しません。

## できること

- 仮想オーディオデバイスなしでデスクトップ音声とマイクを同時録音
- マイク＝自分／システム音声＝相手として、推論なしで確実に 2 話者へ分離
- 相手側をさらに「参加者A / 参加者B …」へ分ける話者クラスタリング（任意）
- 日本語の議事録要約（概要・決定事項・ToDo・議論の流れ）
- 録音一覧と詳細画面（音声再生・話者名の変更・メモ・コピー）
- どの画面でも消えない録音／停止ボタンと、メニューバーからの操作

## 動作要件

| 項目 | 要件 |
| --- | --- |
| macOS | 14.2 以上（Core Audio Process Tap を使用） |
| CPU | Apple Silicon 推奨 |
| メモリ | 16GB 以上 |
| 空き容量 | 約 10GB（モデル用） |

## 使い始める

配布されたアプリを使う場合、事前に用意するものはありません。初回起動時の画面で
保存先を選び、モデルの「ダウンロード」を押すだけです。

| モデル | 用途 | サイズ |
| --- | --- | --- |
| whisper large-v3-turbo (q5_0) | 文字起こし | 574MB |
| Gemma 4 E4B (QAT q4_0) | 要約 | 5.2GB |
| pyannote segmentation / 3D-Speaker | 話者分割（任意） | 約 35MB |

ダウンロードは中断でき、次回は途中から再開します。チェックサムを検証するため、
壊れたモデルを掴むことはありません。**モデルが無くても録音は始められます**ので、
先に会議を録っておいて、後から詳細画面で文字起こしと要約を実行できます。

要約に Gemma 4 E4B を既定にしているのは **128K のコンテキスト**を持つためです。
1 時間規模の会議でも分割せず一度に読ませられるので、部分要約で文脈が切れて
決定事項を取りこぼすことがありません。日本語の扱いも強く、QAT 版なので q4 でも
品質の劣化が小さく済みます。要約は `node-llama-cpp` でアプリ内から直接動かすため、
Ollama のような常駐サーバーは不要です。

### 開発者向け

```bash
npm install
npm run setup   # whisper-cli を Homebrew で導入（開発時の近道）
npm run dev
```

モデルはアプリの初期設定画面からダウンロードできるので、`npm run setup` が
入れるのは `whisper-cli` だけです。

## 音声キャプチャの方式

仮想オーディオデバイスは使いません。macOS 14.2 以降の **Core Audio Process Tap** で
システムの出力を複製して取得します。ScreenCaptureKit（画面収録 API）を使わない理由：

| | Core Audio Tap（採用） | ScreenCaptureKit |
| --- | --- | --- |
| 権限 | オーディオ録音のみ | 画面収録 |
| 収録インジケータ | 出ない | 紫のインジケータが常時点灯 |
| 音量の影響 | 受けない（プリミキサー） | システム音量に追従 |
| 映像処理 | 無し | あり |

初回の録音時に「マイク」と「オーディオ録音」の許可を求められます。

## 保存されるもの

保存先は設定画面で選びます。各録音は 1 つのディレクトリにまとまります。

```
<保存先>/
├── index.json                      # 一覧用のキャッシュ
└── 2026-09-06_1430_チーム定例/
    ├── meta.json                   # この録音の情報（一覧はここから再構築できる）
    ├── audio.m4a                   # AAC-LC 32kbps mono（1 時間あたり約 14MB）
    ├── transcript.json             # 話者・時刻つき（機械可読）
    ├── transcript.md               # コピペ用
    ├── summary.md                  # 要約
    └── note.md                     # 自分のメモ
```

録音中の WAV はアプリの作業ディレクトリに置かれ、エンコード完了後に削除されます。

音声コーデックは設定で変更できます。既定を AAC-LC にしているのは、HE-AAC (`aach`) を
16kHz モノラルに指定すると `afconvert` が指定ビットレートを無視してコアを 8kHz・
約 10kbps まで落とし、会議音声の明瞭さを損なうためです。

モデルは録音の保存先ではなく `~/Library/Application Support/<アプリ名>/models/` に
置かれます。モデルは会議の成果物ではなく再取得できるキャッシュなので、
保存先を圧迫させないためです。

## アーキテクチャ

依存は常に内向き（`src/domain` が最も安定した中心）。

```
src/
├── domain/          エンティティと業務ルール。依存ゼロ
├── application/
│   ├── ports/       外界との境界（インターフェース）
│   └── usecases/    ユースケース。Electron も whisper も llama.cpp も知らない
├── infrastructure/  ポートの実装（audiotee / whisper-cli / llama.cpp / sherpa-onnx / ファイル）
├── main/            Electron main。container.ts が唯一の結線場所
├── preload/         contextBridge で型付き API を公開
└── renderer/        React の UI
```

この境界のおかげで、モデルやバックエンドの差し替えは
[`src/main/worker/pipeline-container.ts`](src/main/worker/pipeline-container.ts) と
設定値だけで完結します。ユースケースは `whisper` も `llama.cpp` も知りません。

### 停止後のパイプライン

`ミックス → 文字起こし → 話者識別 → 要約 → エンコード` の順に実行します。

- ステップ同士は**成果物ファイル経由でのみ**つながるため、詳細画面から
  **失敗したステップだけを再実行**できます。
- 失敗は**依存するステップだけ**を止めます。要約に失敗しても音声とエンコードは
  完了するので、最も価値の高い成果物が守られます。
- パイプラインは `utilityProcess` で動きます。llama.cpp や sherpa-onnx の
  ネイティブコードが落ちても、アプリ本体と録音済みのファイルは残ります。

## 開発

```bash
npm test         # 208 件（domain / application / infrastructure / 統合）
npm run typecheck
npm run dev
npm run build
npm run package  # 配布用の .dmg を作る
```

### whisper-cli の同梱

whisper.cpp は macOS 向けの CLI バイナリを配布していません（リリース資産は
xcframework と Linux/Windows 版のみ）。配布したアプリの利用者に Homebrew を
求めないため、`npm run package` の中で `scripts/build-whisper.sh` が
whisper.cpp を Metal 有効でビルドし、`resources/bin/whisper-cli` として同梱します。

実行時は次の順で解決します。設定でパスを明示すればそれが最優先なので、
手元でビルドした版を使うこともできます。

1. 設定に書かれたパス（既定値 `whisper-cli` 以外のとき）
2. 同梱バイナリ（パッケージ済みアプリのとき）
3. PATH 上の `whisper-cli`（開発時）

`postinstall` で `scripts/patch-dev-electron.sh` が走り、開発用の Electron.app に
`NSAudioCaptureUsageDescription` と `NSMicrophoneUsageDescription` を注入して
ad-hoc 再署名します。これが無いと開発中に音声キャプチャの権限を取得できません。

### モジュール形式について

main / preload は electron-vite の既定である **CJS** で出力します。Electron 33 は
ESM の main も扱えますが、ESM 専用の `audiotee` と `node-llama-cpp` は動的 `import()`
で読み込めばよく（CJS 出力でも `import()` は `require` に変換されません）、既定の
構成から外れる利点がありません。

なお、シェルに `ELECTRON_RUN_AS_NODE=1` が設定されていると Electron が素の Node と
して起動し、`require('electron')` が API を返さないため起動に失敗します。起動しない
ときはこの環境変数を確認してください。

テストは `~/.claude/rules/tdd.md` に従い先に書いています。ユースケースは Fake
だけで完全に検証でき、サーバーも DB も起動しません。統合テストは実際の
ファイル I/O と `afconvert` を通します。
