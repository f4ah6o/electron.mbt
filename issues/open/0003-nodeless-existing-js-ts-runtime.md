# 0003: Node-less で既存 JS/TS Electron アプリを動かす実装 Issue

| 項目 | 内容 |
| --- | --- |
| 状態 | Proposed / 設計 Issue。実装、互換性、サイズ削減は未検証 |
| 作成日 | 2026-10-11 |
| 対象 | `f4ah6o/electron.mbt` / 最初は macOS arm64 |
| 関連 | [0002 Node-less Roadmap](0002-node-less-electron-compatible-moonbit-roadmap.md)、[0001 既存 Node 方針](0001-electron-compatible-lightweight-runtime.md)、[Draft PR #3](https://github.com/f4ah6o/electron.mbt/pull/3)、[M1 PR #2](https://github.com/f4ah6o/electron.mbt/pull/2) |

## 1. 目的と満たすべき成果

既存の JavaScript / TypeScript 製 Electron アプリについて、**ユーザー環境で Node.js を実行・リンク・同梱せず**、対象を明示した Electron API サブセットで起動から代表操作・終了まで実行する。MoonBit は lifecycle / policy / IPC contract / diagnostics を所有し、既存 JS を MoonBit ソースへ変換することを必須にしない。

「Node-less」は **JavaScript-less ではない**。Main の JavaScript 実行には独立した組み込み JS engine（初期評価候補 QuickJS）を使い、renderer は OS WebView を使う。実 Node runner は現在の別 profile に残す。Node API と Electron API の完全互換、V8/Node-API native addon、Chromium の完全互換は目標に含めない。

本 Issue は Roadmap 0002 の **JS/TS 実アプリ実行に関する実装受入条件**であり、現行 `AGENTS.md` / Issue 0001 の Node 前提を暗黙に上書きしない。N0 ADR が承認されるまでは設計提案。PR #2 の既存作業を破棄・変更しない。

## 2. 入口を三つのモードに分離する

| モード | 入口と想定 | 変換 | 公表する互換性 |
| --- | --- | --- | --- |
| **A: Direct CJS** | `main.cjs` / `preload.cjs`、ローカル JS/JSON と allowlist 内の pure JS npm 依存 | 原本の書換えなし、CJS loader で直接実行 | ソース・renderer 既存 asset の hash 一致が取れた範囲だけ `source/distribution unchanged` |
| **B: Prepared JS** | 既にビルド済みの JS アプリ（例: TS プロジェクトの `dist/main.js`） | 提供済み成果物を読み込む | **既存 JS 配布アセット無変更**。未提供の元 `.ts` まで無変更実行したとは言わない |
| **C: TS build** | `.ts` / `.cts` / `.tsx` 等を含む既存プロジェクト | **build 時**に type erase / transpile と必要に応じて bundling。出力 JS を組み込み engine で実行 | 入力元のソースを改変しない `source-preserving build`。生成 JS の hash は別記し、`distribution unchanged` と混同しない |

初期動作確認は **A と C（限定 TypeScript）を独立 fixture** にし、B は A と同じ実行経路で受入する。TypeScript は直接 JS engine に渡さない。JSX/TSX は transformer の対象。ESM main の**無変換での実行**は初期対象外とし、build 時 CJS 変換が正しく成立するケースのみ C に含める。

変換過程で main と preload の実行 realm・権限が混ざらないこと。renderer の JS/TS は WebView 側のブラウザ JS として扱い、main JS engine 上で DOM をエミュレートしない。renderer asset が再ビルドされるならその変更を別欄に記録する。

## 3. Node-less ランタイムの境界

```text
original JS/CJS ───────────────┐
original TS/TSX ─ build adapter ┤  (build only: Node usable; no shipped dependency)
prepared JS dist ──────────────┤
                                 v
                    embedded JS main runner (QuickJS candidate)
                      CJS loader + Electron facade + Node-shim allowlist
                                 | private, versioned transport
                                 v
                     MoonBit core + native OS host
                     lifecycle / sender grants / IPC / diagnostics
                                 |
                         macOS AppKit + WKWebView
                           isolated preload world
                               <-> page world
```

1. **本番 Node 不在:** launcher、runner、native host、bundle が `node` / `libnode` / Node-API addon に依存せず、Bun / Deno / 埋め込み Node を検出・起動・取得しない。開発用 test/oracle/bundler に Node を使う場合は本番配布から除外して audit する。
2. **Main JS engine:** QuickJS と JavaScriptCore 等を N1 で同じ fixture で評価し、engine version / license / ABI / CVE 更新を固定する。MoonBit FFI で例外、GC root、callable identity、callback lifetime、thread affinity を検証する。ES 準拠率だけで Node 互換と主張しない。
3. **CJS loader:** `require('electron')`、`module.exports`、`exports`、相対解決、`__dirname`/`__filename`、循環参照、cache、module identity、JSON module、`package.json.main` を対応範囲ごとに試験する。`exports`/condition/import/dynamic require の非対応経路は安易に別パッケージへ解決せず診断する。
4. **Node shim:** `path`、`events`、`process`、必要に応じて `Buffer`、`fs` 等の **使用 symbol 単位**で提供する。filesystem/clipboard/dialog/shell に権限・パス正規化・symlink・origin 対策を設ける。未対応 `node:` built-in、`.node`、`child_process`、`worker_threads`、任意 network/stream を fail-closed にする。
5. **JS jobs と native loop:** Promise microtasks、host async I/O、timer、`process.nextTick`（もし公開するなら）と event emitter の順序を Electron oracle と差分化。native UI thread で任意 JS を待たない。同期 getter を Promise に置換しない。再入・shutdown・host loss を検証する。
6. **Preload:** WKWebView の隔離 world と page world は main runner とは別の JS realm。main 用 CJS loader をそのまま preload に渡さない。document-start で実 preload をロードし、renderer に Node globals や無制限 IPC を公開しない。
7. **同期 `contextBridge` は block gate:** page からの同期関数戻り値/throw、Promise、callback identity/remove、copy/freeze、最初の page script、nested/reentrant call、navigation 後の失効、frame/document/sender の OS 観測値を検証。共有 DOM event / page 管理 nonce / async postMessage / private WebKit API は代替証拠にならない。実現できない場合 `electron-nodeless-v1` は blocked とする。
8. **互換状態:** native-only MoonBit デスクトップが動作しても Electron-compatible とは表示しない。`compatibility/nodeless-manifest.json`（提案）に profile とソース hash、engine・OS・WebView・Electron oracle を記録。Node 版の既存 manifest を自動で verified にしない。

## 4. TypeScript の build-only パイプラインと失敗条件

- 候補は **バージョン固定した esbuild 等の build-time transformer**。変換・bundle は配布前に実行し、生成結果・tool version・変換設定・ソース/出力 hash・sourcemap を収集する。tool も Node runtime も製品 artifact に含めない。
- 型チェックは transpilation とは別。`tsc --noEmit` などの結果を別に記録し、`transpile PASS` を `typecheck PASS` と表示しない。
- `tsconfig.json` の対象範囲（`target`、`module`、`moduleResolution`、`paths`、`baseUrl`、JSX）、`.cts`/`.mts`、TSX、decorators、トップレベル await、dynamic import、`package.json.exports` を **機能単位の matrix** に固定する。
- 変換により `require('electron')`、module identity、isolated preload 初期化順、同期 API とイベント順序が変わるケースは unsupported/FAIL。Node built-in の bundler external 化で本番に未実装 `require('node:fs')` が残る場合は **preflight FAIL** とする。
- 原本プロジェクトがすでに `dist` を含む場合は B を優先して、存在しない `.ts` 構文をランタイム対応と誤認しない。build 時変換が必要な場合は C の変換レポートを必須にする。
- ビルドだけで判明する制約と、動的 `require` 等で実行時に初めて判明する制約を分ける。静的診断の green だけで App Compatible を宣言しない。

## 5. 実装の順序と出口

- [ ] **N0: ADR + fixture selection** — 対象アプリ revision とライセンス、操作シナリオ、`main`/`preload`/`renderer` 依存の inventory、A/B/C の既存 asset hash、Node/Electron symbol allowlist、pins を承認する。
- [ ] **N1a: embedded engine probe** — CJS fixture + simple TS transformed fixture、microtask/timers/throw/listener identity、native transport と Sync BrowserWindow の trace を確認する。
- [ ] **N1b: isolated sync bridge probe** — 現行 M0 の既知の偽装可能性を解消し、実 preload を用いた同期 return/throw・Promise/callback・原本 hash 保持の oracle 差分に合格する。失敗なら既存 Electron profile を成功扱いしない。
- [ ] **N2: native-only vertical slice** — Node 不在の macOS native launcher で WebView 表示/操作/close/quit と OS cleanup を確認する。
- [ ] **N3: source-preserving CJS facade** — A/B の `require('electron')`/Node shim と IPC/preload の production wiring、C の TS build pipeline + fail-closed preflight を接続する。
- [ ] **N4: real app acceptance** — 実アプリ（A/B と C は別証跡）で起動・代表操作・保存・再起動・終了、security/IME/accessibility を試験。`App Compatible` は対象 revision と操作範囲限定。
- [ ] **N5: shipping proof** — 本番 artifact のリンク依存/ファイル一覧/プロセスツリー/clean OS 動作と署名、Electron 比の配布サイズ・cold/warm 起動・全子プロセスメモリの再現可能な測定を提出する。

**実装開始ゲート:** N0 で `AGENTS.md` と Node 版との共存/置換を ADR に記録してから、コード変更を開始する。これ以前に通常 `run`/`pack` や既存互換 manifest の `compatible` を true にしない。

## 6. 受入テスト仕様（現時点はすべて未実行）

| ID | 条件 | 期待値 |
| --- | --- | --- |
| J1 | 変更していない CJS main/preload + pure JS dependency が `require('electron')` | 正確な module identity、原本 hash 一致、差分ログ |
| T1 | `.ts` main / `.ts` preload（Node API allowlist 内）を build | 入出力/設定 hash と sourcemap、同一アプリ操作、renderer 隔離 |
| T2 | `tsconfig.paths` や decorators 等、unsupported な TS 設定 | 診断が明示的に失敗し、暗黙の変換で成功扱いしない |
| E1 | CJS `require` cache/cycle/JSON/dependency identity と Promise/timer 順序 | pinned Electron oracle と比較可能な trace |
| S1 | iframe なりすまし、DOM reply 偽装、reload 後の stale callback | privileged 操作拒否、document grants 失効、同期橋の安全性 |
| F1 | unsupported `node:`/`.node`/外部 navigation/危険な path | fail-closed、エラー分類と対象 API/位置がわかる |
| N1 | Node がない macOS clean machine で packaged app を実行 | Node/libnode/Node-API が起動・リンク・同梱されない証拠 |
| P1 | 同一 revision と機能の Electron と比較 | installer/展開サイズ、初回取得、起動 median/p95、全 process memory |

各 fixture について **実行コマンド、実行 OS/SDK/CPU、tool/engine/Electron version、PASS/FAIL/未実行、source/hash、出力 evidence** を保存する。macOS 実機試験を Linux unit test で代用しない。N1b が blocked の場合は縮小した別 profile として明示し、Electron 互換を主張しない。

## 7. 今回の設計 PR と実装着手の線引き

本 Issue と Roadmap 0002 を review できることが今回の完了条件。**実装・E2E・release ビルド・サイズ計測は未実施**。今後の子 Issue は N1a、N1b、N2、N3、N4/N5 に分割可能。Main の Node-less 実行に成功しても、同期 contextBridge のブロックを解消するまで `electron-nodeless-v1` は互換済みにしない。

### 参考

- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)
- [QuickJS](https://bellard.org/quickjs/)
- [esbuild TypeScript](https://esbuild.github.io/content-types/#typescript)（typecheck ではないこと、tsconfig/emit 制約を参照）
- [esbuild Build & Bundle](https://esbuild.github.io/getting-started/)
