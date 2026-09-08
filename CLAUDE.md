# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリについて

macOS 向けの Web 会議レコーダー（Electron + React + TypeScript）。録音・文字起こし・
話者識別・要約をすべてローカルで実行し、音声もテキストも外部に送信しない。
詳細な背景は `README.md` と `docs/`（`architecture.html` / `specification.html` /
`decisions.html` = ADR-001〜023）にある。**設計の「なぜ」を変える変更をする前に
`docs/decisions.html` の該当 ADR を読むこと。**

## コマンド

```bash
npm run dev          # electron-vite dev（開発起動）
npm run typecheck    # tsc --noEmit（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes）
npm run lint         # oxlint
npm test             # vitest run
npm run test:watch
npm run build        # typecheck + electron-vite build
npm run package      # build + whisper-cli ビルド + electron-builder
npm run setup        # 開発用に whisper-cli を Homebrew で導入
```

単一テストの実行:

```bash
npx vitest run tests/application/process-recording.test.ts
npx vitest run -t "テスト名の一部"
```

注意点:

- **macOS 必須**。テストは実際の `/usr/bin/afconvert` を通し、`postinstall` は
  PlistBuddy と codesign を使う。CI も `macos-15` ランナー。
- `npm run lint` は **oxlint**（`.oxlintrc.json`）。TypeScript 7 が従来の JS コンパイラ
  API を公開しなくなり typescript-eslint が動かないため、ESLint ではなく oxlint を使う。
  `react/set-state-in-effect` と一部の `jsx-a11y` は既知の未対応として警告に留めてある
  （エラーではないので lint は通る）。CI は typecheck / lint / test / build を回す。
- vitest は `TZ=Asia/Tokyo` を固定している。保存ディレクトリ名がローカル時刻由来のため。
- シェルに `ELECTRON_RUN_AS_NODE=1` があると `npm run dev` が起動に失敗する。

## アーキテクチャ

### 層と依存の向き

クリーンアーキテクチャ。依存は内向きのみ。パスエイリアス（`@domain` `@application`
`@infrastructure` `@shared` `@renderer`）が層を表す。

- `src/domain/` — 純粋な業務ルール。Electron も Node の I/O も知らない。
- `src/application/usecases/` — ユースケース。`src/application/ports/index.ts` の
  インターフェースしか知らない。
- `src/infrastructure/` — ports の実装（audiotee / whisper.cpp / sherpa-onnx /
  node-llama-cpp / afconvert / ファイル I/O）。
- `src/main/` `src/preload/` `src/renderer/` — Electron。

**結線は 2 か所だけ**: `src/main/container.ts`（main プロセス用）と
`src/main/worker/pipeline-container.ts`（ワーカー用）。実装を差し替えるならここを変える。
`pipeline-container.ts` は **`electron` を import してはいけない** — utilityProcess は
electron API を持たないため、パスは `OMR_USER_DATA` / `OMR_RESOURCES` 環境変数で渡す。

### プロセス構成

| プロセス | 役割 |
| --- | --- |
| renderer | UI と **マイク取得**（AudioWorklet → `IPC.pushMicPcm` で main へ PCM を送る） |
| main | 録音制御・システム音声キャプチャ（audiotee）・ライブラリ操作・IPC |
| utilityProcess（`pipeline-worker`） | 文字起こし・話者識別・要約。ネイティブのクラッシュを隔離し、ジョブは 1 件ずつ直列 |

ワーカーは `PipelineClient` が必要時に fork し、落ちたら次の依頼で作り直す
（ADR-008）。`pipeline-worker` は `electron.vite.config.ts` で main の独立エントリ
として定義されている。

### 録音とパイプライン

2 トラック（システム音声＝相手 / マイク＝自分）を分けたまま WAV に書き、
推論なしで 2 話者を確定させるのが設計の核（`DualTrackRecorder`）。
停止後のパイプラインは `PIPELINE_STEPS = ['mix','transcribe','diarize','summarize','encode']`。

- ステップ同士はファイル（成果物）を介してのみつながるので、`only` 指定の
  個別リトライが成立する。
- 依存関係は `ProcessRecording.ts` の `STEP_DEPENDENCIES`。失敗は依存ステップだけを
  止め、独立したステップは走らせる（要約が失敗しても音声は残る、ADR-010）。

### main / renderer の境界

`src/shared/ipc.ts` が契約。境界を越えるのは **DTO（プリミティブと素の object）だけ**
— `Date` や class インスタンスは渡さない（`startedAt` は ISO 文字列）。
IPC ハンドラは `src/main/ipc/handlers.ts`、公開は `src/preload/index.ts`
（`contextIsolation: true`）。main ↔ ワーカーの契約は `src/main/worker/protocol.ts`。

### データの置き場所

- 録音の成果物 → 設定の保存先ルート配下、1 録音 = 1 ディレクトリ
  （`meta.json` / `audio.m4a` / `transcript.json` / `transcript.md` / `summary.md` / `note.md`）。
  一覧キャッシュは `index.json`、フォルダ定義は `folders.json`。`index.json` は
  各 `meta.json` から再構築できるキャッシュに過ぎない（ADR-015）。
- モデル → `~/Library/Application Support/<app>/models/`（保存先ではない。再取得可能なため）
- 設定 → `userData/settings.json`、録音中の中間 WAV → `userData/work/`

ディレクトリ名は `slugForRecording()` が `YYYY-MM-DD_HHmm-<id先頭8桁>` で作る。
タイトルは後からリネームできるのでディレクトリ名には含めない。

## 開発上の約束

- TDD（`~/.claude/rules/tdd.md`）に従い、テストを先に書く。ユースケースは
  `tests/application/fakes.ts` の Fake だけでサーバーも DB も無しに検証できる。
  この構造を壊す変更（ユースケースに具体実装を持ち込むなど）はしない。
- 統合テスト（`tests/integration/pipeline.test.ts`）は実際のファイル I/O と
  `afconvert` を通す。
- コード中のコメントは日本語で、「何を」ではなく「なぜ」を書く既存のスタイルに合わせる。
- `electron-builder.yml` の `productName` は **ASCII のまま**にする。日本語にすると
  生成アプリが起動直後に SIGTRAP で落ちる（表示名は `CFBundleDisplayName` 側、ADR-013）。
- 音声コーデックの既定を AAC-LC から HE-AAC に変えない（`afconvert` がビットレート
  指定を無視して品質が落ちる、ADR-005）。
