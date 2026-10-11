# 0003: Node.js実行時依存なしで既存JS/TS Electronアプリを実行する

Status: open
Model: GPT-6
Created: 2026-10-11
Updated: 2026-10-11
Branch: devin/1791702808-node-less-roadmap

## 概要

**種別:** Node-less既存JS/TSアプリ実行の実装Issue（N1〜N5を含む親Issue）。**優先度:** N1bの同期`contextBridge`安全性ゲートが最優先、次にN1aのエンジン/FFI検証。**利用者への影響:** 適合が確認された既存Electronアプリを、Node.jsを起動・配布せずに実行できるようにする。ただし現時点で製品・実装・互換性は未確認。

対象は`f4ah6o/electron.mbt`の**macOS/Apple Silicon**版。MoonBit core + native host + OS WebView + 埋め込みJS engineで、指定したAPI/値型・アプリrevisionのElectron互換を目指す。[Roadmap 0002](0002-node-less-electron-compatible-moonbit-roadmap.md)の実装受入基準を、このIssueだけで着手判断できる形にする。

## 背景

- 現行`AGENTS.md`と[Issue 0001](0001-electron-compatible-lightweight-runtime.md)はNode.jsを使う設計。既存[PR #2](https://github.com/f4ah6o/electron.mbt/pull/2)のmacOS実験M1を消去せず、Node-less版は**別プロファイル・別証跡**とする。
- 現在のmainブランチは`cmd/electron-mbt.cjs`、`bridges/node/cjs-loader.cjs`などNode依存の診断・プローブを含む。`core/runtime.mbt`は共通契約の再利用候補で、まだNode-less hostやengineとは接続されていない。
- `fixtures/oracle/main.cjs`は固定Electronでの同期API/イベント観察に使える。ただし単体のoracle成功や`WKWorldProbe.m`によるworld分離の観察は、Node-less preloadの同期bridgeが成立した証拠ではない。
- GitHub Issuesがリポジトリで無効のため、本Issueの正本は`issues/open/0003-nodeless-existing-js-ts-runtime.md`。同じ対象の設計を説明する[0002](0002-node-less-electron-compatible-moonbit-roadmap.md)は上位Roadmapとして保持する。

## 問題

1. `main.js`/`main.cjs`はNode module resolver、`process`、`Buffer`、`fs`、イベントループ等に依存することがあり、Nodeを削除するだけでは動作しない。
2. `.ts`/`.tsx`はJavaScript engineで通常そのまま実行できず、既存のビルド済みJSと、明示的なTypeScript変換を必要とするアプリの互換判定が異なる。
3. renderer上の隔離`contextBridge`とmain側組み込みJS engineは別課題。公開WKWebView APIで同期関数と元の呼び出し元の認証を両立する方法は未実証。
4. 依存ライブラリの実行失敗、変換時の`node:` external残存、module identity差異、native addon、frame偽装を診断せずスキップすると危険な「動いた」判定になる。

## 目標

- **A（Direct CJS）:** 原本`main.cjs`/`preload.cjs`とrenderer assetを変更せず、pure-JS dependencyと`require('electron')`を対象サブセットに限って実行する。
- **B（Prepared JS）:** 既存アプリのビルド成果物`dist/main.js`等をそのまま実行し、元がTypeScript製でも「TypeScriptランタイムが動く」とは称さない。
- **C（TS build）:** `.ts`/`.cts`/`.tsx`を**ビルド時**にJS/CJSへtranspile/bundleして実行する。元ソースhash、生成JS hash、変換設定、toolchain、sourcemap、typecheckとtranspile結果を別々に記録する。
- AとCの最低1つずつのfixtureを定義し、N0で選定した実アプリ1件以上について固定Electronと同じ代表操作を比較する。
- Nodeがないclean macOSで署名済み成果物を実行し、Node/link/dependency/process監査およびsize/startup/memory実測までを受入条件に含める。

## 対象外

- Node.js全組み込みAPI/npm完全互換、Node-API/V8 ABIの`.node`アドオン、`child_process`、`worker_threads`、ASAR/autoUpdater/Chromium CDPの初期対応。
- JavaScriptをMoonBitソースへ全面変換、型情報を保持したままTSを本番で直接解釈すること、全ESM main/preloadの無変換実行。
- Electronのセキュリティ境界を弱める`contextIsolation:false`、`sandbox:false`、`webSecurity:false`、rendererへの汎用権限委譲。
- Electron基準の全アプリ・全APIを保証すること、`main`/PR #2/既存userDataの無承認変更。他OSは別の適合Issue。

## 提案する方針

| 段階 | ファイル/モジュール（新規提案は明記） | 具体契約 |
| --- | --- | --- |
| N0: inventoryと仕様 | 既存`compatibility/manifest.json`、`fixtures/cjs`、`fixtures/oracle/`、`tests/loader.test.cjs`を参照。新規`compatibility/nodeless-manifest.json`・`fixtures/nodeless/`を検討 | `main/preload/renderer`区分・module format・使用symbolのallowlistとunsupported・source/build hashをmanifest化 |
| N1a: embedded engine | 新規候補`bridges/embedded-js/` + MoonBit C FFI。既存`bridges/node/cjs-loader.cjs`/`bridges/node/sync_channel.c`はコードでなく契約/fixtureを参照 | engine version固定、CJS module cache/identity/cycle/JSON、Promise microtasks、timers、exceptions、listener lifecycle、GC rooting、sync transportでのtimeout/host loss |
| N1b: isolated bridge | 既存`platform/macos/WKWorldProbe.m`、`fixtures/worlds`、`fixtures/oracle`を参照し独立macOS native probe（新規） | real preload document-start、sync return/throw、Promise、callback/frozen copy、sender/frame/document認証、reload失効を両立できるか判定 |
| N2: native launcher | 新規native executableと`platform/macos/` adapter、既存`core/runtime.mbt` | Node未起動のnative-only window/AppKit/WKWebView、OS close/quit/cancel、異常終了時のリソース解放 |
| N3: JS/TS/Electron façade | 新規CJS loader、`node:` symbol allowlist shim、TS build-only adapter、Electron facade/IPC | source identity/URL/stack/error、module resolution/require、限定`app`/`BrowserWindow`/IPC/OS service、fail-closed diagnosticsを一致させる |
| N4〜N5: app/配布 | 新規差分テスト/packaging。既存`cmd/electron-mbt.cjs`はNode専用として存置 | 対象アプリの実操作/IME/アクセシビリティ/負荷・セキュリティ、NodeがないMacで署名/依存/プロセスツリー/容量/起動時間を確認 |

**本番はNode実行ファイル/libnode/Node-APIをリンク・起動・同梱しない。** 開発時のElectron oracle、typecheck、transpiler、既存Node CIは別プロセス・別証跡なら利用可。QuickJSは第一候補であり採用済みではない。

**入力判定ルール:** AはCJS entryと依存のsource hashが一致、Bは既存JS成果物のhashが一致、Cはsource hashが一致していても新しい生成JSのhashを公開し`distribution unchanged`とは称さない。`typecheck PASS`を`transpile PASS`の代用にせず、`tsconfig.paths`、JSX、decorators、`.mts`、dynamic import、`package.json.exports`は**N0で選んだ個々の構文だけ対応**し、それ以外は説明可能なエラーで拒否する。

**同期bridgeのNo-Go:** pageが変更可能なDOM response、page可読nonce、単純`postMessage()`、`evaluateJavaScript()`、private WebKit API、同期メソッドのPromise置換は電子アプリ互換の成立証拠にしない。N1b失敗時は`electron-nodeless-v1`をblockedとしてIssueにfailure evidenceを残し、async-onlyは別profile/ADRへ切り分ける。

## 受け入れ条件

- [ ] **J1 Given** 原本`main.cjs`とpure JS dependencyが`require('electron')`する、**when** Aとして起動する、**then** 同じfacade identity、正しい`module.exports`/cache/cycles、原本・renderer asset hash一致を記録できる。
- [ ] **B1 Given** 既にJSにビルドされたElectronアプリ配布物がある、**when** Bとして起動する、**then** JS配布物を無変更で扱い、原本TypeScriptをランタイム実行したと誤表示しない。
- [ ] **T1 Given** 入力`.ts` mainとpreload、およびpinned変換tool/設定がある、**when** Cのbuildを実行する、**then** 生成JS/sourcemap/入力hash/出力hash/`tsc --noEmit`結果を別記し、Bと区別できる。
- [ ] **T2 Given** unsupported decorator、path alias、`.mts`、動的require、`node:` external等の対象外構文/依存がある、**when** build/preflight/runtimeを実行する、**then** 当該経路が判明した時点で識別可能なエラーを返し、非対応機能を黙って成功扱いしない。
- [ ] **E1 Given** fixed Electron oracleと同じCJS/TS fixtureがある、**when** 埋め込みengineとMoonBitを通して実行する、**then** error identity/stack・Promise job/timer順序・sync getter/window event lifecycleの差分を再現可能なtraceで比較できる。
- [ ] **S1 Given** pageに悪意あるiframe、DOM listener改変、stale callbackがある、**when** `contextBridge`とIPCを使用する、**then** 原本preloadがdocument-startで隔離され、同期return/throw/Promise/callbackの意味を保持し、元のsender/frame/document以外の特権呼出を拒否できる。
- [ ] **F1 Given** unsupported `.node`/`node:`/外部navigation/symlink逸脱/巨大payloadがある、**when** 実行・事前診断を行う、**then** 未対応/認証拒否/上限超過の種別と対象位置が示される。
- [ ] **N1 Given** Node未導入のclean macOSで署名済みpackageがある、**when** 起動し指定操作・終了を試す、**then** libnode/Node実行体/Node-APIがリンク・同梱・動的取得・起動されず、関連プロセスが正常に終了する。
- [ ] **P1 Given** 同一revision/機能/CPUのElectron版がある、**when** 同条件でrelease測定する、**then** アーカイブ/展開サイズ、初回総取得量、全関連processのメモリ、cold/warm起動median/p95が出力される。改善値の閾値はN0 baseline後に固定する。
- [ ] **R1 Given** N1bの同期/送信元認証が成立しない、**when** 実装ゲートの報告を行う、**then** `electron-nodeless-v1`はblocked・`compatible:false`のままで、失敗fixtureと代替方針候補をADRに残し、通常run/packを開放しない。

## テスト計画

| 検証 | 現在存在するコマンドと、追加予定の手段 | 判定 |
| --- | --- | --- |
| 既存回帰 | `moon check --target js` / `moon test --target js` / `moon test --target native` / `npm test`（既存、Node profile用） | 実行済みと未実行を別記。Node版の成功をNode-less版の互換証拠に転用しない |
| module identity / CJS / TS | 既存`tests/loader.test.cjs`をoracle参照し、新規`fixtures/nodeless/`、embedded engine test、TS build fixtureを実装後に実行（新コマンドは**未定**） | J1/B1/T1/T2/E1のpositive/negative、source hash・expected exceptions・結果trace |
| sync preload / sender | pinned Electron oracle + macOS WKWebView probeの実機比較（既存world分離probeだけでは不可） | S1の同期return/throw、Promise/callback、prototype汚染、iframe、reload/grantsの拒否を実測 |
| cleanup/security | Node無しclean macOS、symlink/root escape、host/crash/restart、超過payload、記録のredaction | F1/N1: 途中で終了/例外でも特権漏れ・orphan process・誤成功がない |
| 製品比較 | 同じrevision/CPU/アプリ操作で圧縮/展開サイズ、cold/warm起動、全プロセスメモリ、電池/CPUなど採用した指標 | P1: 実測値/サンプル数/median/p95/環境を記録し、結果を推定で埋めない |

**まだ実装されていないもの:** JS engine adapter、TypeScript pipeline、Node-less CLI、preload sync bridge、署名/計測script。コマンド名やPASS数値は作らず、コードを追加した子Issueで具体化する。現在の作業はドキュメント編集のみ。

## リスク

- **Critical:** public WKWebViewで安全な同期function proxyを実現できない可能性。検証前に任意DOM同期イベントへprivileged operationを載せない。
- **High:** QuickJS等のPromise microtasks vs Node event loop差、FFI GC root/closure lifetime、separate process native sync requestの再入・デッドロック・host crash。
- **High:** CJS module resolverの挙動差、動的require/条件付きexports、Buffer/fs/processの部分shims、誤った`node:` external解決、.node addon非対応。
- **High:** sender/frame/document generation・origin偽装、TOCTOU/symlink、巨大payload、privileged preload callbackの旧document使い回し。
- **Medium:** TS build時の原本/生成物追跡漏れ、型チェックとtranspileの混同、sourcemap stackの差異、engine license/セキュリティ更新責任、OS WebView共有runtimeの存在差。
- **移行・変更履歴:** Node付き`desktop-core-v1`との共存維持、既存`userData`の非破壊、profile固有manifest/診断、将来の切り戻しと配布更新計画をADRに含める。

## 変更履歴

- 2026-10-11: Node-less既存JS/TS実行受入のリポジトリ内Issueとして作成。Draft PR #3に添付。
- 2026-10-11: `polish-issue`の形式へ整理し、A/B/Cモード、変更対象ファイル、Given/When/Then、評価コマンド種別、セキュリティNo-Go、未解決事項を明記。

## 注記

- **状態:** `open`。N0の実アプリ/API集合・engineが未選定で、N1bの同期bridge安全性が未証明。実装の一括着手が安全と判断できる段階ではない。N0/N1a/N1bを順に独立実装・検証すること自体は可能。
- **現在の編集ブランチ:** `devin/1791702808-node-less-roadmap`（Draft PR #3）。将来の実装用候補は`feat/nodeless-engine-probe`、`feat/nodeless-sync-bridge`であり、作成済みではない。
- **保留理由/再開条件:** N1bがFailなら互換profileをblockedとし、失敗fixtureの実機再現・公開APIによる安全な代替方針のADRが揃ったら検討を再開する。復帰先は現在の`issues/open/0003-nodeless-existing-js-ts-runtime.md`。別の状態ディレクトリはこのリポジトリに未定義。
- **既存との差異:** Node版の`npm test`、macOS probe、Electron oracle PASSはこのIssueのN1b・Node-less合格ではない。`main`/PR #2と他リポジトリは今回編集しない。

## 未解決の質問

1. 公開WKWebViewで同一document/frameの**真のpage initiator**を認証し、sync return/throw/callbackを両立できるか。N1b実機probeの結果がないうちはblocked riskが残る。
2. 最初の1件の実Electronアプリをどのrevision・操作・ライセンスで評価するか。実アプリ依存のNode shim allowlistとサポートするTS設定はN0で採番・固定する。
3. QuickJS/JavaScriptCore等のどのmain engineとプロセス配置にするか。FFI・Job queue・保守コスト・配布サイズの比較をN1aで実測してから採否を決める。
4. JS/TS変換器の正確なバージョン、unsupported configの一覧、出力Module形式、依存bundlingの方針は何か。N0でfixtureと一緒に承認する。

## 詳細仕様・受入台帳（元の内容を保持）

### 1. 目的と満たすべき成果

既存の JavaScript / TypeScript 製 Electron アプリについて、**ユーザー環境で Node.js を実行・リンク・同梱せず**、対象を明示した Electron API サブセットで起動から代表操作・終了まで実行する。MoonBit は lifecycle / policy / IPC contract / diagnostics を所有し、既存 JS を MoonBit ソースへ変換することを必須にしない。

「Node-less」は **JavaScript-less ではない**。Main の JavaScript 実行には独立した組み込み JS engine（初期評価候補 QuickJS）を使い、renderer は OS WebView を使う。実 Node runner は現在の別 profile に残す。Node API と Electron API の完全互換、V8/Node-API native addon、Chromium の完全互換は目標に含めない。

本 Issue は Roadmap 0002 の **JS/TS 実アプリ実行に関する実装受入条件**であり、現行 `AGENTS.md` / Issue 0001 の Node 前提を暗黙に上書きしない。N0 ADR が承認されるまでは設計提案。PR #2 の既存作業を破棄・変更しない。

### 2. 入口を三つのモードに分離する

| モード | 入口と想定 | 変換 | 公表する互換性 |
| --- | --- | --- | --- |
| **A: Direct CJS** | `main.cjs` / `preload.cjs`、ローカル JS/JSON と allowlist 内の pure JS npm 依存 | 原本の書換えなし、CJS loader で直接実行 | ソース・renderer 既存 asset の hash 一致が取れた範囲だけ `source/distribution unchanged` |
| **B: Prepared JS** | 既にビルド済みの JS アプリ（例: TS プロジェクトの `dist/main.js`） | 提供済み成果物を読み込む | **既存 JS 配布アセット無変更**。未提供の元 `.ts` まで無変更実行したとは言わない |
| **C: TS build** | `.ts` / `.cts` / `.tsx` 等を含む既存プロジェクト | **build 時**に type erase / transpile と必要に応じて bundling。出力 JS を組み込み engine で実行 | 入力元のソースを改変しない `source-preserving build`。生成 JS の hash は別記し、`distribution unchanged` と混同しない |

初期動作確認は **A と C（限定 TypeScript）を独立 fixture** にし、B は A と同じ実行経路で受入する。TypeScript は直接 JS engine に渡さない。JSX/TSX は transformer の対象。ESM main の**無変換での実行**は初期対象外とし、build 時 CJS 変換が正しく成立するケースのみ C に含める。

変換過程で main と preload の実行 realm・権限が混ざらないこと。renderer の JS/TS は WebView 側のブラウザ JS として扱い、main JS engine 上で DOM をエミュレートしない。renderer asset が再ビルドされるならその変更を別欄に記録する。

### 3. Node-less ランタイムの境界

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

### 4. TypeScript の build-only パイプラインと失敗条件

- 候補は **バージョン固定した esbuild 等の build-time transformer**。変換・bundle は配布前に実行し、生成結果・tool version・変換設定・ソース/出力 hash・sourcemap を収集する。tool も Node runtime も製品 artifact に含めない。
- 型チェックは transpilation とは別。`tsc --noEmit` などの結果を別に記録し、`transpile PASS` を `typecheck PASS` と表示しない。
- `tsconfig.json` の対象範囲（`target`、`module`、`moduleResolution`、`paths`、`baseUrl`、JSX）、`.cts`/`.mts`、TSX、decorators、トップレベル await、dynamic import、`package.json.exports` を **機能単位の matrix** に固定する。
- 変換により `require('electron')`、module identity、isolated preload 初期化順、同期 API とイベント順序が変わるケースは unsupported/FAIL。Node built-in の bundler external 化で本番に未実装 `require('node:fs')` が残る場合は **preflight FAIL** とする。
- 原本プロジェクトがすでに `dist` を含む場合は B を優先して、存在しない `.ts` 構文をランタイム対応と誤認しない。build 時変換が必要な場合は C の変換レポートを必須にする。
- ビルドだけで判明する制約と、動的 `require` 等で実行時に初めて判明する制約を分ける。静的診断の green だけで App Compatible を宣言しない。

### 5. 実装の順序と出口

- [ ] **N0: ADR + fixture selection** — 対象アプリ revision とライセンス、操作シナリオ、`main`/`preload`/`renderer` 依存の inventory、A/B/C の既存 asset hash、Node/Electron symbol allowlist、pins を承認する。
- [ ] **N1a: embedded engine probe** — CJS fixture + simple TS transformed fixture、microtask/timers/throw/listener identity、native transport と Sync BrowserWindow の trace を確認する。
- [ ] **N1b: isolated sync bridge probe** — 現行 M0 の既知の偽装可能性を解消し、実 preload を用いた同期 return/throw・Promise/callback・原本 hash 保持の oracle 差分に合格する。失敗なら既存 Electron profile を成功扱いしない。
- [ ] **N2: native-only vertical slice** — Node 不在の macOS native launcher で WebView 表示/操作/close/quit と OS cleanup を確認する。
- [ ] **N3: source-preserving CJS facade** — A/B の `require('electron')`/Node shim と IPC/preload の production wiring、C の TS build pipeline + fail-closed preflight を接続する。
- [ ] **N4: real app acceptance** — 実アプリ（A/B と C は別証跡）で起動・代表操作・保存・再起動・終了、security/IME/accessibility を試験。`App Compatible` は対象 revision と操作範囲限定。
- [ ] **N5: shipping proof** — 本番 artifact のリンク依存/ファイル一覧/プロセスツリー/clean OS 動作と署名、Electron 比の配布サイズ・cold/warm 起動・全子プロセスメモリの再現可能な測定を提出する。

**実装開始ゲート:** N0 で `AGENTS.md` と Node 版との共存/置換を ADR に記録してから、コード変更を開始する。これ以前に通常 `run`/`pack` や既存互換 manifest の `compatible` を true にしない。

### 6. 受入テスト仕様（現時点はすべて未実行）

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

### 7. 今回の設計 PR と実装着手の線引き

本 Issue と Roadmap 0002 を review できることが今回の完了条件。**実装・E2E・release ビルド・サイズ計測は未実施**。今後の子 Issue は N1a、N1b、N2、N3、N4/N5 に分割可能。Main の Node-less 実行に成功しても、同期 contextBridge のブロックを解消するまで `electron-nodeless-v1` は互換済みにしない。

#### 参考

- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)
- [QuickJS](https://bellard.org/quickjs/)
- [esbuild TypeScript](https://esbuild.github.io/content-types/#typescript)（typecheck ではないこと、tsconfig/emit 制約を参照）
- [esbuild Build & Bundle](https://esbuild.github.io/getting-started/)
