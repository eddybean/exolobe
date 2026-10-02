# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリについて

**Exolobe** — macOS 向けの Web 会議録音アプリ（Electron + React + TypeScript）。録音・文字起こし・
話者識別・要約をすべてローカルで実行し、音声もテキストも外部に送信しない。
詳細な背景は `README.md` と `docs/`（`architecture.html` / `specification.html` /
`decisions.html` = ADR-001〜048）にある。**設計の「なぜ」を変える変更をする前に
`docs/decisions.html` の該当 ADR を読むこと。**

## コマンド

```bash
npm run dev          # electron-vite dev（開発起動）
npm run typecheck    # tsc --noEmit（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes）
npm run lint         # oxlint
npm run fmt          # oxfmt で整形（CI は npm run fmt:check）
npm test             # vitest run
npm run test:watch
npm run build        # typecheck + electron-vite build
npm run package      # build + whisper-cli / micwatch / calendarevents / applelm のビルド + electron-builder
npm run setup        # macOS: whisper-cli を Homebrew で導入し、補助プログラムをビルド / Windows: 道具の有無を確かめる
npm run build:whisper  # whisper.cpp をビルド（macOS: Metal と Core ML / Windows: Vulkan と CPU、Vulkan SDK が要る）。配布版はこちら
npm run build:micwatch # micwatch をビルド（macOS: Swift の main.swift / Windows: Rust、同じ native/micwatch に同居）
npm run build:calendarevents # calendarevents（Swift、カレンダー連携）をビルド
npm run build:applelm # applelm（Swift、Apple Intelligence での要約）をビルド
npm run build:syscapture # syscapture（Rust、Windows のシステム音声の取り込み）をビルド。Windows 専用
npm run build:audioconv  # audioconv（Rust、Windows の録音の保存と音声の取り込み、Media Foundation）をビルド。Windows 専用
npm run eval:transcription  # 文字起こしの評価（合成音声、数分。CI では走らない）
```

単一テストの実行:

```bash
npx vitest run tests/application/process-recording.test.ts
npx vitest run -t "テスト名の一部"
```

注意点:

- **開発は macOS が前提**。テストは実際の `/usr/bin/afconvert` を通し、`postinstall` は
  PlistBuddy と codesign を使う。CI は `xcode-27` ランナー（macOS 27 SDK が要るため、ADR-045）。
- Windows 対応を進めている（ADR-048）。CI の `test-windows` が Windows でも typecheck / lint / fmt:check /
  test / build を回す。macOS のコマンドや `#!/bin/sh` の偽バイナリを実際に使うテストは
  `describe.skipIf(notMacOS)`（`tests/platform.ts`）で囲み、パスの期待値は `/` で書かず `join` で組む。
- 同梱バイナリ（`scripts/build-*.sh`）の最低対応 OS は `electron-builder.yml` の `LSMinimumSystemVersion` から
  `scripts/min-macos.sh` が読む。指定しないとビルドした機械の OS になり、古い macOS で起動しない（ADR-045）。
- `postinstall`（`scripts/postinstall.mjs` が macOS でだけ `scripts/patch-dev-electron.sh` を呼ぶ）は開発用 Electron.app に
  `NSAudioCaptureUsageDescription` / `NSMicrophoneUsageDescription` を注入して ad-hoc 再署名する。
  これが無いと開発中に音声キャプチャの権限を取れない。`npm ci` し直したら再実行される。
- whisper-cli は「設定のパス（既定値 `whisper-cli` 以外）→ 同梱バイナリ → PATH」の順に解決する。
  `npm run setup` が入れる Homebrew 版は Core ML 無しなので、Core ML の高速化を開発中に
  確かめるときは `npm run build:whisper` のビルドを設定でパス指定する（ADR-007 / ADR-026）。
- リリースは Actions の **Bump version**（手動実行）が版上げの PR を作り、マージで `tag-release.yml` が
  タグを打って `release.yml` を起動する（手元からの `v*` タグの push でも動く）。GITHUB_TOKEN の push は
  他のワークフローを起動しないため、CI と Release は `gh workflow run` で明示的に起動している。
  whisper-cli と node_modules のキャッシュは **main の CI が作り、Release は読むだけ**（タグの実行が
  保存したキャッシュは次のタグから見えない）。キーは `ci.yml` と `release.yml` で揃える。Secrets に
  `MAC_CERT_P12_BASE64` / `MAC_CERT_PASSWORD`（署名）と `APPLE_ID` /
  `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`（公証）が揃えば正式に署名・公証し、
  無ければ ad-hoc 署名になる。Windows の NSIS のインストーラは `release.yml` の `build-windows` が作る（署名なし）。
  Release は `prepare` が先に **Draft** で作り、`SHA256SUMS.txt` は `checksums` が両方の OS の成果物からまとめて作る。
  成果物を手で確かめてから GitHub の画面で公開すると、`publish-release.yml` が Homebrew の cask を更新する
  （Draft の dmg は公開の URL から落とせないので、cask は公開まで進めない。プレリリースでは更新しない）。
  手元で作るときは `npm run package:win`。
- `npm run lint` は **oxlint**（`.oxlintrc.json`）。TypeScript 7 が従来の JS コンパイラ
  API を公開しなくなり typescript-eslint が動かないため、ESLint ではなく oxlint を使う。
  `react/set-state-in-effect` と一部の `jsx-a11y` は既知の未対応として警告に留めてある
  （エラーではないので lint は通る）。CI は typecheck / lint / fmt:check / test / build を回す。
- 整形は **oxfmt**（`.oxfmtrc.json`）。Vite+（`vp fmt` の中身も oxfmt）は `vite` を Vite 8 系の
  `@voidzero-dev/vite-plus-core` に差し替える前提で、electron-vite 5 の peerDependencies
  （`vite ^5 || ^6 || ^7`）と合わないため入れていない。electron-vite が Vite 8 に対応したら見直す。
  一括整形のコミットは `.git-blame-ignore-revs` に載せてある（`git config blame.ignoreRevsFile .git-blame-ignore-revs`）。
- `dev` / `typecheck` / `test` の前に `scripts/check-node-modules.mjs` が走り、
  `node_modules` が `package-lock.json` と食い違っていれば止める。worktree を別ブランチに
  使い回すと lockfile だけが進み、古い依存（例: Electron 33 のまま）が型エラーなど
  コードの不具合に見える形で出るため。止まったら `npm ci` する。
- 文字起こしに関わる変更（whisper の引数、`parseWhisperJson` の関門）は、
  `npm run eval:transcription` で前後を比べる。表の差は「今回 − 基準」で、どの列もマイナスが改善。
  施策を採ったら `OMR_EVAL_UPDATE_BASELINE=1` で `baseline.json` を取り直してコミットする。
  **worktree には `resources/bin` が無い**ので、そのままだと PATH の Homebrew 版（版が違う）で
  測ってしまう。`OMR_EVAL_WHISPER_CLI` で配布版のパスを渡す（表の上に版が出るので確かめる）。
  合成音声の VAD 有り（既定）ではハルシネーションがほぼ出ず、改善より「悪くしていないか」を見る物差しに近い。
- vitest は `TZ=Asia/Tokyo` を固定している。保存ディレクトリ名がローカル時刻由来のため。
- シェルに `ELECTRON_RUN_AS_NODE=1` があると `npm run dev` が起動に失敗する。
- `OMR_LOG_DROPPED_SEGMENTS=1` を付けて起動すると、文字起こしで落としたセグメントを
  理由（`non-speech` / `boilerplate` / `low-confidence` / `repetition`）と平均対数確率つきで端末へ出す。
  確信度の閾値を実録音で見直すための計測用。**既定では何も出さない** — 落としたセグメントには
  会議の本文がそのまま載るため、通常の利用でログに残してはいけない。

## アーキテクチャ

### 層と依存の向き

クリーンアーキテクチャ。依存は内向きのみ。パスエイリアス（`@domain` `@application`
`@infrastructure` `@shared` `@renderer`）が層を表す。

- `src/domain/` — 純粋な業務ルール。Electron も Node の I/O も知らない。
- `src/application/usecases/` — ユースケース。`src/application/ports/index.ts` の
  インターフェースしか知らない。
- `src/infrastructure/` — ports の実装（audiotee / whisper.cpp / sherpa-onnx-node /
  node-llama-cpp / afconvert / ファイル I/O）。
- `src/main/` `src/preload/` `src/renderer/` — Electron。

**結線は 4 か所だけ**: `src/main/container.ts`（main プロセス用）、
`src/main/worker/pipeline-container.ts`（パイプラインのワーカー用）、
`src/main/worker/search-container.ts`（意味検索のワーカー用）、
`src/main/worker/chat-container.ts`（チャットのワーカー用）。実装を差し替えるならここを変える。
ワーカー用の 3 つは **`electron` を import してはいけない** — utilityProcess は
electron API を持たないため、パスは `OMR_USER_DATA` / `OMR_RESOURCES` 環境変数で渡す。

### プロセス構成

| プロセス | 役割 |
| --- | --- |
| renderer | UI と **マイク取得**（AudioWorklet → `IPC.pushMicPcm` で main へ PCM を送る） |
| main | 録音制御・システム音声キャプチャ（audiotee）・ライブラリ操作・IPC |
| utilityProcess（`pipeline-worker`） | 文字起こし・話者識別・要約。ネイティブのクラッシュを隔離し、ジョブは 1 件ずつ直列 |
| utilityProcess（`search-worker`） | 意味検索（bge-m3 の埋め込み・索引の同期）。依頼は並行に受け、3 分使われなければ終了 |
| utilityProcess（`chat-worker`） | ライブラリ全体へのチャット（要約と同じ Gemma を使う）。生成は 1 件ずつ、2 分使われなければ終了（ADR-033） |
| 子プロセス（`micwatch`） | 他アプリのマイク使用を見張り、録音の開始忘れを知らせる（録音中は動かさない、ADR-027）。Windows 版は WASAPI の録音セッションを数え、親（main）以下のプロセスの木を除く |
| 子プロセス（`syscapture`） | Windows でシステム音声を WASAPI のプロセス loopback で取り込み、PCM を stdout に流す。このアプリの音は除き、stdin が閉じたら止まる（ADR-048） |
| 子プロセス（`calendarevents`） | 録音開始時に EventKit で重なる予定を引く。呼ぶたびに起動して終わる（ADR-040） |
| 子プロセス（`applelm`） | 要約のモデルに Apple Intelligence を選んだとき、パイプラインのワーカーが 1 回の応答ごとに起動する。設定画面の可否の表示は main が `status` で聞く（ADR-046） |

パイプラインのワーカーは `PipelineClient` が必要時に fork し、ジョブが片付いたら終了させて次の依頼で
作り直す。要約も話者識別も数 GB を使うネイティブコードで、プロセスごと終わらせるのが
確実にメモリを返す方法だから（ADR-008）。意味検索のワーカーは `SearchClient` が管理し、
連続する検索のためにモデルを温めておく代わりに、パイプラインが動き出したら同期を止めて終了させる
（ADR-029）。どちらも `electron.vite.config.ts` で main の独立エントリとして定義されている。

### 録音とパイプライン

2 トラック（システム音声＝相手 / マイク＝自分）を分けたまま WAV に書き、
推論なしで 2 話者を確定させるのが設計の核（`DualTrackRecorder`）。
停止後のパイプラインは `PIPELINE_STEPS = ['mix','transcribe','diarize','summarize','encode']`。
パイプラインの入力は `src/domain/RecordingSource.ts` の判別共用体（`dual` = 2 トラック録音 /
`single` = 取り込んだ音声）で、どの WAV をどの話者として起こすかは同ファイルの純粋関数が決める。
**`PIPELINE_STEPS` に要素を足してはいけない** — 既存の完了済み録音は新しいステップが `pending` で
補われ、`overallStatus` が永久に `processing` を返す（ADR-030）。

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
  （`meta.json` / `audio.m4a` / `transcript.json` / `transcript.md` / `summary.md` / `note.md` /
  `voices.json` = 話者ごとの声紋 / `bookmarks.json` = 録音中の印）。
  一覧キャッシュは `index.json`、フォルダ定義は `folders.json`、声紋帳は `voiceprints.json`。
  `index.json` は各 `meta.json` から再構築できるキャッシュに過ぎない（ADR-015）。
  `voiceprints.json` は**再生成できない**ので、キャッシュとして扱わない（ADR-031）。
- モデル → `~/Library/Application Support/<app>/models/`（保存先ではない。再取得可能なため）。
  どの配布物を置いたかは同じ場所の `installed.json`（sha256 の記録。ファイルから求め直せるキャッシュ）。
  カタログ（`ModelCatalog.ts`）のモデルを差し替えるときは、Hugging Face の URL をコミットで固定し
  `sha256` と一緒に書き換える。既存の利用者には一覧に「更新あり」が出る（ADR-039）
- 意味検索の索引 → `userData/search/<録音ID>.json`（再生成できるキャッシュ。本文は持たず、
  チャンクの位置と 8 ビット量子化したベクトルだけ。削除済み録音の分は同期時に消える）
- 設定 → `userData/settings.json`、録音中の中間 WAV と `tracks.json` → `userData/work/`
  （パイプライン完了時に消える）
- 同梱バイナリ → `resources/bin/`（`whisper-cli` / `micwatch` / `calendarevents` / `applelm` / `ggml-metal.metal`、Windows は `syscapture.exe` / `audioconv.exe`）。
  ソースは `native/micwatch/` と `native/calendarevents/` と `native/applelm/`（Swift）、`native/syscapture/` と `native/audioconv/`（Rust）。配置は `scripts/build-*` が行う。パスの解決は
  `resolve*Binary.ts` が開発時とパッケージ時で切り替える（ADR-016）

ディレクトリ名は `slugForRecording()` が `YYYY-MM-DD_HHmm-<id先頭8桁>` で作る。
タイトルは後からリネームできるのでディレクトリ名には含めない。

## 開発上の約束

- TDD（`~/.claude/rules/tdd.md`）に従い、テストを先に書く。ユースケースは
  `tests/application/fakes.ts` の Fake だけでサーバーも DB も無しに検証できる。
  この構造を壊す変更（ユースケースに具体実装を持ち込むなど）はしない。
- 統合テスト（`tests/integration/pipeline.test.ts`）は実際のファイル I/O と
  `afconvert` を通す。
- **コードベースの調査はサブエージェント（`model: sonnet`）に投げる**（下記）。
- **renderer を変えたら、可能な範囲で実際にアプリを起動して確かめる**（下記）。
- コード中のコメントは日本語で、「何を」ではなく「なぜ」を書く既存のスタイルに合わせる。
- `electron-builder.yml` の `productName` は **ASCII のまま**にする。日本語にすると
  生成アプリが起動直後に SIGTRAP で落ちる（ADR-013）。`Exolobe` は ASCII なので
  `CFBundleDisplayName` による別名は持たせていない。
- 話者識別は **`sherpa-onnx-node`（ネイティブアドオン）** を使う。npm の `sherpa-onnx` は
  WASM ビルドで、線形メモリの上限 2GB を拡張できず 40 分を超える録音が必ず失敗する
  （ADR-028）。戻してはいけない。
- 意味検索の索引に**本文を複製しない**（録音の完全削除が崩れる）。タイトルも対象にしない
  （短いタイトルがクエリの「〜したミーティング」と一致して本文より上に来る、ADR-029）。
- 音声コーデックの既定を AAC-LC から HE-AAC に変えない（`afconvert` がビットレート
  指定を無視して品質が落ちる、ADR-005）。
- 過去の録音の声紋は `audio.m4a` から取り直す（ADR-034）。**話者識別はやり直さない** —
  クラスタ番号が振り直され、既に付けた名前との対応が崩れる。入力はミックス済みなので
  `transcript.json` の `self` と重なる区間を引く。`compute()` には
  `enableExternalBuffer = false` を渡す（既定の true は Electron の V8 が外部バッファを
  禁じていて必ず失敗する。素の Node では通るのでテストでは気付けない）。
- 話者名の自動適用（ADR-031）で、**声紋帳が育つのは話者のリネームからだけ**にする
  （実体は `RememberSpeakerVoice`、呼ぶのはリネームの IPC ハンドラ 1 か所）。
  自動で当てた名前を学習に戻すと、一度の取り違えが声紋に混ざって次の取り違えを呼ぶ。
  引き当てた名前は、その録音で既に付いている名前より優先しない（利用者の訂正を推定で押し戻さない）。
- チャットで**どの録音を見るかを LLM の tool calling に決めさせない**（ADR-032）。日付・話者・
  話題の解釈は `src/domain/DateExpression.ts` と `src/domain/ChatQuery.ts` の純粋関数が行う。
  4B のモデルは日付の計算をしばしば外し、外したことが出力から見えない。
  **意味検索が無効なときは話題語での絞り込みをしない** — 「該当なし」が検索結果なのか
  確かめられなかっただけなのか区別できず、期間で答えられる問いまで「記録がありません」になる。
- チャットのプロンプト（`src/domain/ChatPrompt.ts`）は**設定で編集可能にしない**。
  「文脈だけを根拠にする」「`[1]` で引用する」という出力の契約を含み、画面の引用表示が
  それに依存する（ADR-032）。
- 保存データの形を変えるときは ADR-035 に従う。項目の追加は番号を上げずに既定値で補い、
  意味が変わるときだけ object のファイルの `schemaVersion` を上げる（配列の `voiceprints.json` /
  `folders.json` はファイル名を変える）。**読めないもの・知らないキーを、理解できた部分だけで
  上書きしない** — 書き込みは `jsonFile.ts` の `replaceStoredJson` / `replaceVersionedJson` を通す。
- 録音の自動開始（ADR-041）は**会議 URL 付きの予定があるときだけ**。予定の無いマイク使用で自動開始させない
  （ADR-027 が避けた誤録音が戻る）。自動で始めた・止めた・破棄した会議は `meetingLookup` が扱い終えとして覚え、
  同じ会議で始め直さない。破棄は `DiscardRecording` を通し、停止 → 削除の 2 手にしない（間にパイプラインが走る）。
- 録音中のメモの時刻は **note.md の本文に `[hh:mm:ss]` で埋める**（ADR-042）。別ファイルに行と対応づけて持たない
  （録音後の編集で対応が崩れる）。印は `bookmarks.json`。要約には `{{notes}}` で渡すが必須にはしない
  （足す前に保存したプロンプトがあるため、無ければ末尾に付ける）。
- **UI の文言をコードに直接書かない**（ADR-043）。main は `src/main/i18n.ts`、renderer は `src/renderer/i18n/`、
  両方で使うもの（失敗の理由・モデル名・ステップ名）は `src/shared/i18n/` の表に `ja` と `en` を並べ、
  `const en: typeof ja` でキーの取りこぼしを型検査に拾わせる。語順や単複が変わる文は関数にする。
  **domain・application・infrastructure は文言を持たない** — 失敗は `ErrorReason` を持つ `AppError` で投げ、
  文言は表示する側（main のハンドラ・renderer）が UI の言語で引く。ステップの失敗も文言ではなく理由を保存する。
- **UI の言語と会議の言語を混ぜない**（ADR-043）。UI の言語は起動時に macOS の優先言語で決まる。
  要約プロンプト・話者の既定名・メモの見出しは会議の言語（文字起こしの言語設定、`auto` なら UI の言語）、
  チャットの指示文は問いの言語で決める。英語の指示文も ADR-032 の出力の契約を日本語版と同じに持つ。
  テストは `tests/setup.ts` が日本語 UI にしている。英語を確かめるテストは中で `setLocale('en')` して戻す。
- 新しい版の通知（ADR-044）は**知らせるだけ**で、アプリは自分を入れ替えない（ad-hoc 署名では electron-updater が使えない）。
  GitHub Releases の 404（非公開の間）や通信の失敗は**「更新なし」として扱い、画面に出さない**。配布ページの URL は
  main だけが持ち、renderer から URL を受け取って開かない。
- 要約のモデルに Apple Intelligence を選べる（ADR-046）が、**既定は Gemma のまま**にする。評価で決定事項と ToDo の
  混同・期限の取り違えが多く、1 時間を超える会議では要約として崩れた。選んでいる間は設定画面に精度の注意を出し続ける。分割・統合・防御の前置きは
  `LlamaCppSummarizer` を共用し、`applelm` は 1 回の応答だけを受け持つ（コンテキストが 8192 トークンしかないので、
  呼ぶたびに新しいセッションにする）。**macOS 27 未満では使えないことにする** — 評価したのは 27 のモデル。
  チャットは Gemma のまま（ライブラリ全体を文脈に入れるには狭い）。
- 要約プロンプトは**既定かカスタムかを `summarization.promptMode` で持つ**（ADR-047）。既定は全文を見て
  判定しない（`settings.json` は全体を保存するので、既定の文面を直すと触っていない人まで「書き換えた」ことになる）。
  既定の本文は画面で編集させず、既定の文面は `DEFAULT_SUMMARY_PROMPT(_EN)` を書き換えれば全員に届く。
  `isDefaultSummaryPrompt` は `promptMode` を持たない前の設定の読み替えにだけ使う。
- 取り込める拡張子は**変換器ごとに** `src/domain/AudioImport.ts` に持ち（afconvert / Media Foundation）、デコーダと組で
  `src/main/audioConverters.ts` が OS に応じて選ぶ。一覧を変えたら、実機でその形式を変換して確かめる（ADR-048）。
- 取り込んだ音声は**全体を相手側（remote）として扱う**。自分の声を推定して `self` に割り当てると、
  外したときに「自分が言っていない発言」が残る（ADR-030）。変換は取り込み時に `afconvert` で
  16kHz モノラルにし、`--mix` を外さない（片チャンネルを捨てると話者が丸ごと消える）。Windows の audioconv も
  チャンネルを混ぜて 1ch にする（Source Reader に 1ch を求める。片チャンネルだけを取り出す形に変えない）。

### 調査はサブエージェントに投げる

コードベースを読んで把握する作業（どこに何があるか、既存の実装がどうなっているか、
似た機能の探索）は、`Agent` ツールでサブエージェントにやらせる。手元の文脈は
**設計の判断と、実際に編集するファイル**のために空けておく。

判断に迷わないよう、条件で切る:

- **投げる** — 3 ファイル以上を「理解するため」に読むとき／500 行を超えるファイルの通読／
  「〜がどう実装されているか調べて」の類。並列で投げてよいが 3 本まで。
- **自分で読む** — これから編集するファイル／報告に矛盾や不足が出た箇所／100 行未満のファイル。
- **やってはいけない** — 起動中のエージェントを待つ間の時間つぶしに関係ファイルを読むこと。
  待つなら何もせずターンを終える（完了は通知で届く）。

モデルは既定で Sonnet（`~/.claude/settings.json` の `env.CLAUDE_CODE_SUBAGENT_MODEL`）。
単純な列挙や grep で済むものは `model: haiku` を明示する。逆に**設計・アーキテクチャの検討や
コードレビューを任せるときは `model: opus` を明示する** — そこは安く済ませる場所ではない。

ただし**広さはエージェント、深さと検証は自分**で切り分ける。報告は要約なので、設計を
左右する事実はコマンドやファイルで裏を取る。実例として、調査エージェントが「`afconvert` は
FLAC / Ogg / Opus 非対応」と報告したが、`afconvert -hf` を実行すると対応していた。
鵜呑みにしていれば、不要な ffmpeg の同梱を設計に入れていた。

### UI の変更を実機で確かめる

renderer のテストは純粋関数までで、描画の結果は見ていない。`hidden` 属性が
`.tree__list` の `display` 指定に負けて要素が消えない、といった不具合は
テストを全て通したまま残る。UI を変えたときは `agent-browser` スキルで
アプリを起動して確かめる（Electron を CDP 経由で操作できる）。

```bash
npm run build
# 実データに触れないよう、userData を一時ディレクトリに向ける。
UD=$(mktemp -d)/userData
HOME=$(dirname "$UD") ./node_modules/.bin/electron out/main/index.js \
  --remote-debugging-port=9222 --user-data-dir="$UD" &
agent-browser connect 9222
agent-browser snapshot -i -c        # 要素を見る（@eN は操作のたびに取り直す）
agent-browser click @e10
agent-browser fill @e8 "天気の話をした会議"
agent-browser press Enter
agent-browser screenshot /tmp/ui.png   # 画像を実際に見て確かめる
```

注意点:

- **隔離は `--user-data-dir` で行う**。`HOME` だけでは効かず、既定の userData を見に行く。
  録音の保存先は、一時ディレクトリに `meta.json` / `transcript.json` を書いた
  合成データを使い、利用者の実データは開かない。
- `ELECTRON_RUN_AS_NODE` が環境にあると起動に失敗する（`env -u` で外す）。
- README のスクリーンショット（`docs/images/app-library.png`）は `node scripts/screenshot-fixtures.mjs <出力先>`
  の架空データで撮る。`<出力先>/userData` を `--user-data-dir` に渡せば保存先もそこを指す。
- **ネイティブダイアログ（`dialog.showMessageBox`）は操作できない。** 削除の確認などは
  ここまでで、押した先は手動で確かめる。
- **マイク・システム音声の許可は自動化できない。** 録音を伴う確認は手動。
- **英語の画面は `OMR_LOCALE=en` を付けて起動して確かめる**（OS の言語設定は変えない）。英語は日本語より
  文言が長く、`white-space: nowrap` や固定幅の要素がはみ出しやすい。文言を足したら両方の言語で見る。
- **`agent-browser set viewport` で幅をエミュレートしない。** 撮れる画は実際のウィンドウ
  （既定 1180×820、最小幅 900）と違う幅になり、利用者が見る姿と食い違う。
  幅ごとの崩れを見たいときだけ使い、見た目の確認は実ウィンドウのまま撮る。
- `agent-browser screenshot` はページの描画だけでウィンドウ枠を含まない。アプリの見た目を
  そのまま撮るなら `screencapture` でウィンドウを指定する（ホストに画面収録の許可が要る）:

  ```bash
  # Electron のウィンドウ番号を引いて、そのウィンドウだけを撮る（-o で影を落とす）
  WID=$(swift -e 'import CoreGraphics
  let l = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
  for w in l where w[kCGWindowOwnerName as String] as? String == "Electron"
    && w[kCGWindowLayer as String] as? Int == 0 { print(w[kCGWindowNumber as String]!) }' | head -1)
  screencapture -x -o -l "$WID" /tmp/window.png
  ```

### Windows での開発

フェーズ 2 の作業（eddybean/exolobe#137）はネイティブの Windows で行う。WSL からは WASAPI も
Electron の GUI も扱えない。

```powershell
npm ci
npm run setup        # whisper-cli・cargo などの有無を確かめて知らせるだけ（何も入れない）
npm run dev
```

- システム音声の取り込み（`syscapture.exe`）と録音の保存・音声の取り込み（`audioconv.exe`）は `npm run setup` か
  `npm run build:syscapture` / `npm run build:audioconv` で作る（cargo が要る）。
  実機での取り込みは `npm run test:manual` で確かめる（CI のランナーには音声デバイスが無い）。
- マイク使用の見張り（`micwatch.exe`）も `npm run setup` か `npm run build:micwatch` で作る。試すときは、マイクを使う側を
  アプリの木の外で起動する（PowerShell の `Start-Process` など）。Node や Exolobe の子として起動すると、自分の使用として除かれる。
- whisper-cli は `npm run build:whisper` で `resources/bin` に作る（Vulkan SDK が要る。`npm run setup` も SDK があれば呼ぶ）。
  開発中の Windows は、macOS と違って `resources/bin` の whisper-cli を使う（Homebrew に当たる入れ方が無いため）。
  バックエンドは DLL に分かれている（`ggml-vulkan.dll` / `ggml-cpu-*.dll`）。CPU だけで確かめるときは、
  `ggml-vulkan.dll` を除いた複製のフォルダの whisper-cli を `OMR_EVAL_WHISPER_CLI` や設定のパスで指す。
- 文字起こしの評価は、Windows では手元の録音だけで回る（`OMR_EVAL_EXTRA_DIR`、合成音声は macOS の `say` で作るため）。
  基準（`baseline.json`）は macOS の合成音声の結果なので、Windows では取り直さない。
- 補助プログラム（Rust）は C ランタイムを静的に組み込む（`native/*/.cargo/config.toml`）。whisper-cli は DLL に
  分かれているので、Visual C++ ランタイムの DLL を `resources/bin` に一緒に置く。どちらも、ランタイムが入っていない
  機体で起動しないのを避けるため。依存は `dumpbin /dependents` で確かめる。
- node-llama-cpp は CUDA を除いて GPU を選ぶ（`llamaOptionsFor`）。CUDA 版のパッケージは開発中の node_modules にはあるが、
  配布物からは外している（electron-builder.yml の files）。GPU 無しで確かめるときは `NODE_LLAMA_CPP_GPU=false` で起動する
  （whisper-cli の Vulkan は別に動くので、VRAM の増減だけで要約が CPU だったと判断しない）。
- 保存先が exFAT など所有者を記録しないドライブだと、git が `dubious ownership` で止まる（`gh` も巻き込まれる）。
  `git config --global --add safe.directory <パス>` を足すか、`gh` は `-R eddybean/exolobe` を付けて呼ぶ。

UI の確かめ方は上の節と同じく `--user-data-dir` で隔離する。架空データは Windows では**音声無し**で書き出される
（`audio.m4a` は afconvert で作るため）。再生バーは出るが鳴らない。一覧・文字起こし・要約・設定は確かめられる。

```bash
# Git Bash で。PowerShell なら `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction Ignore` で外してから起動する。
npm run build
FX=$(mktemp -d)
node scripts/screenshot-fixtures.mjs "$FX"
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron out/main/index.js   --remote-debugging-port=9222 --user-data-dir="$FX/userData" &
agent-browser connect 9222
```

- `HOME` の付け替えは要らない（Windows の userData は `--user-data-dir` だけで決まる）。
- `electron out/main/index.js` で起動すると、「このアプリについて」の版は Electron の版になる
  （package.json の無い `out/main` がアプリのパスになるため）。`npm run dev` なら正しい。
- ウィンドウ枠ごと撮る `screencapture` に当たるものは無い。ページの描画は `agent-browser screenshot` で撮る。枠やメニューバーまで
  見るときは、PowerShell で `GetWindowRect` と `Graphics.CopyFromScreen` を使い、**アプリのウィンドウの範囲だけ**を撮る
  （画面全体を撮ると、利用者が開いている別の内容が写り込む）。
- 通知は画面を撮らずに、`ToastNotificationManager.History.GetHistory('io.github.eddybean.exolobe')` で中身（本文・ボタン）を読む。
- このセッションから送ったキー入力（`keybd_event` / SendKeys）では、グローバルショートカットが反応しなかった。登録できているかは、
  同じ組み合わせを `RegisterHotKey` で取りに行き、失敗する（Exolobe が握っている）ことで確かめ、押したときの動きは手で確かめる。
- **agent-browser の出力をパイプに通さない**（`| head` など）。最初の呼び出しで起動する常駐プロセスがパイプを
  握ったままになり、コマンドが返らない。見たいときはファイルへリダイレクトしてから読む。
- `npm install -g agent-browser` を mise の Node で入れたら `mise reshim` する。しないと PATH に出てこない。

Windows でしか走らないテスト（WASAPI・Media Foundation・`.exe` の補助プログラムを実際に使うもの）は
`tests/platform.ts` の `notWindows` で `describe.skipIf(notWindows)` と囲む。macOS 専用の `notMacOS` と対にする。
