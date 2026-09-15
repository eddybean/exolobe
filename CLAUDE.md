# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリについて

macOS 向けの Web 会議レコーダー（Electron + React + TypeScript）。録音・文字起こし・
話者識別・要約をすべてローカルで実行し、音声もテキストも外部に送信しない。
詳細な背景は `README.md` と `docs/`（`architecture.html` / `specification.html` /
`decisions.html` = ADR-001〜034）にある。**設計の「なぜ」を変える変更をする前に
`docs/decisions.html` の該当 ADR を読むこと。**

## コマンド

```bash
npm run dev          # electron-vite dev（開発起動）
npm run typecheck    # tsc --noEmit（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes）
npm run lint         # oxlint
npm test             # vitest run
npm run test:watch
npm run build        # typecheck + electron-vite build
npm run package      # build + whisper-cli / micwatch のビルド + electron-builder
npm run setup        # 開発用に whisper-cli を Homebrew で導入し、micwatch をビルド
npm run build:whisper  # whisper.cpp を Core ML 有効でビルド（配布版はこちら）
npm run build:micwatch # micwatch（Swift）をビルド
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
- `OMR_LOG_DROPPED_SEGMENTS=1` を付けて起動すると、文字起こしで落としたセグメントを
  理由（`non-speech` / `boilerplate` / `low-confidence`）と平均対数確率つきで端末へ出す。
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
| 子プロセス（`micwatch`） | 他アプリのマイク使用を見張り、録音の開始忘れを知らせる（録音中は動かさない、ADR-027） |

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
  `voices.json` = 話者ごとの声紋）。
  一覧キャッシュは `index.json`、フォルダ定義は `folders.json`、声紋帳は `voiceprints.json`。
  `index.json` は各 `meta.json` から再構築できるキャッシュに過ぎない（ADR-015）。
  `voiceprints.json` は**再生成できない**ので、キャッシュとして扱わない（ADR-031）。
- モデル → `~/Library/Application Support/<app>/models/`（保存先ではない。再取得可能なため）
- 意味検索の索引 → `userData/search/<録音ID>.json`（再生成できるキャッシュ。本文は持たず、
  チャンクの位置と 8 ビット量子化したベクトルだけ。削除済み録音の分は同期時に消える）
- 設定 → `userData/settings.json`、録音中の中間 WAV と `tracks.json` → `userData/work/`
  （パイプライン完了時に消える）
- 同梱バイナリ → `resources/bin/`（`whisper-cli` / `micwatch` / `ggml-metal.metal`）。
  ソースは `native/micwatch/`、配置は `scripts/build-*.sh` が行う。パスの解決は
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
  生成アプリが起動直後に SIGTRAP で落ちる（表示名は `CFBundleDisplayName` 側、ADR-013）。
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
- 取り込んだ音声は**全体を相手側（remote）として扱う**。自分の声を推定して `self` に割り当てると、
  外したときに「自分が言っていない発言」が残る（ADR-030）。変換は取り込み時に `afconvert` で
  16kHz モノラルにし、`--mix` を外さない（片チャンネルを捨てると話者が丸ごと消える）。

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
- **ネイティブダイアログ（`dialog.showMessageBox`）は操作できない。** 削除の確認などは
  ここまでで、押した先は手動で確かめる。
- **マイク・システム音声の許可は自動化できない。** 録音を伴う確認は手動。
