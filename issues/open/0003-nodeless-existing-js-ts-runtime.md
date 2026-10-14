# 0003: Node.js実行時依存なしで既存JS/TS Electronアプリを実行する

Status: open
Model: GPT-6
Created: 2026-10-11
Updated: 2026-10-11
Branch: devin/1791702808-node-less-roadmap

## 概要

**種別:** Node-less既存JS/TSアプリ実行の実装親Issue。**優先度:** N1a QuickJS native C FFI、次いでN1b-adaptedのnative security proof。**利用者への影響:** Nodeなしで既存のrenderer/JS mainを動かす計画だが、現時点でNode-less製品は未実装・未検証。

[ADR-0001](../../docs/adr/0001-nodeless-macos-runtime-decisions.md)で初期方針を決定した。**QuickJS 2026-06-04採用、strict同期`contextBridge`は初版No-Go、監査済み非同期IPCの`electron-nodeless-adapted-v1`を別プロファイルとして設計**。原本preloadを一般的に同一意味で実行できるとは主張しない。`preload adapted`の差分は必ず表示する。

一次実アプリは **Moji v1.0.5**（TypeScript、commit `b7b1d585d61772a0f791f165c8d07a420443b65b`）、二次は **jmd v0.2.3**（CommonJS、commit `f875fc616feb89ea803a0fc140ec770a2ade041e`）。[対象registry](../../compatibility/nodeless-targets.json) に両方のentryと受入シナリオを記録している。N0の**symbol単位依存inventory**は未実行。

## 背景

- 現行`AGENTS.md`と[Issue 0001](0001-electron-compatible-lightweight-runtime.md)はNode.jsを使う設計。既存[PR #2](https://github.com/f4ah6o/electron.mbt/pull/2)のmacOS実験M1を消去せず、Node-less版は**別プロファイル・別証跡**とする。
- 現在のmainブランチは`cmd/electron-mbt.cjs`、`bridges/node/cjs-loader.cjs`などNode依存の診断・プローブを含む。`core/runtime.mbt`は共通契約の再利用候補で、まだNode-less hostやengineとは接続されていない。
- `fixtures/oracle/main.cjs`は固定Electronでの同期API/イベント観察に使える。ただし単体のoracle成功や`WKWorldProbe.m`によるworld分離の観察は、Node-less preloadの同期bridgeが成立した証拠ではない。
- GitHub Issuesがリポジトリで無効のため、本Issueの正本は`issues/open/0003-nodeless-existing-js-ts-runtime.md`。同じ対象の設計を説明する[0002](0002-node-less-electron-compatible-moonbit-roadmap.md)は上位Roadmapとして保持する。

## 問題

1. `main.js`/`main.cjs`はNode module resolver、`process`、`Buffer`、`fs`、イベントループ等に依存することがあり、Nodeを削除するだけでは動作しない。
2. `.ts`/`.tsx`はJavaScript engineで通常そのまま実行できず、既存のビルド済みJSと、明示的なTypeScript変換を必要とするアプリの互換判定が異なる。
3. rendererのstrict同期`contextBridge`とmain側JSエンジンは別課題。public WKWebViewで安全な汎用同期関数proxyは**初版ではunsupportedと決定**。adaptedは非同期APIに限定し、native frame/document/grant検証が未実証。
4. 依存ライブラリの実行失敗、変換時の`node:` external残存、module identity差異、native addon、frame偽装を診断せずスキップすると危険な「動いた」判定になる。

## 目標

- **A（Direct CJS）:** 原本`main.cjs`/`preload.cjs`とrenderer assetを変更せず、pure-JS dependencyと`require('electron')`を対象サブセットに限って実行する。
- **B（Prepared JS）:** 既存アプリのビルド成果物`dist/main.js`等をそのまま実行し、元がTypeScript製でも「TypeScriptランタイムが動く」とは称さない。
- **C（TS build）:** `.ts`/`.cts`/`.tsx`を**ビルド時**にJS/CJSへtranspile/bundleして実行する。元ソースhash、生成JS hash、変換設定、toolchain、sourcemap、typecheckとtranspile結果を別々に記録する。
- A (jmd v0.2.3 CJS) と C (Moji v1.0.5 TS build) のfixtureを用意する。Mojiでサンプル→編集→dialog open→saveAs→reopen→quitのM1〜M3をElectronと比較し、完全互換ではなくadapted `App Scenario Supported` の判定を行う。
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
| N1b-adapted: allowlisted async bridge | 既存`platform/macos/WKWorldProbe.m`等を参考に新規WKWebView host / frame-document guard（予定） | `WKUserScript` pageWorld document-startの許可済みPromise API。hostにてframe/origin/document/grant/args検証、reload/iframe/DOM spoof負例を確認。strict同期proxyは初版対象外 |
| N2: native launcher | 新規native executableと`platform/macos/` adapter、既存`core/runtime.mbt` | Node未起動のnative-only window/AppKit/WKWebView、OS close/quit/cancel、異常終了時のリソース解放 |
| N3: JS/TS/Electron façade | 新規CJS loader、`node:` symbol allowlist shim、TS build-only adapter、Electron facade/IPC | source identity/URL/stack/error、module resolution/require、限定`app`/`BrowserWindow`/IPC/OS service、fail-closed diagnosticsを一致させる |
| N4〜N5: app/配布 | 新規差分テスト/packaging。既存`cmd/electron-mbt.cjs`はNode専用として存置 | 対象アプリの実操作/IME/アクセシビリティ/負荷・セキュリティ、NodeがないMacで署名/依存/プロセスツリー/容量/起動時間を確認 |

**本番はNode実行ファイル/libnode/Node-APIをリンク・起動・同梱しない。** 開発時のElectron oracle、typecheck、transpiler、既存Node CIは別プロセス・別証跡なら利用可。**QuickJS 2026-06-04を選定済み**、ただしFFI実装と互換性は未実証。

**入力判定ルール:** AはCJS entryと依存のsource hashが一致、Bは既存JS成果物のhashが一致、Cはsource hashが一致していても新しい生成JSのhashを公開し`distribution unchanged`とは称さない。`typecheck PASS`を`transpile PASS`の代用にせず、`tsconfig.paths`、JSX、decorators、`.mts`、dynamic import、`package.json.exports`は**N0で選んだ個々の構文だけ対応**し、それ以外は説明可能なエラーで拒否する。

**Strict No-Go / adapted Go条件:** 公開WKWebView初版ではstrict `electron-nodeless-v1`は**最初からblocked**。同期return/throw/任意closure proxyをPromiseへ置換してElectron互換と偽らない。別 `electron-nodeless-adapted-v1`はnative側でoperation allowlist・実frame/origin/document/grant/limitを検証し、Promise APIとローカルsync disposerだけを提供する。共有DOM response、page可読nonce、private WebKit APIは認証・回避手段にならない。実機負例に失敗すればadaptedもblocked。

## 受け入れ条件

- [ ] **J1 Given** jmd v0.2.3 の原本`main.js`/CJS dependencyがある、**when** QuickJS loaderで`require('electron')`を評価する、**then** facade/module identity、cache/cycle、original hashを記録し、`jmd-file:` custom privileged protocolは明示的にunsupportedとする。
- [ ] **B1 Given** Moji v1.0.5のupstream `electron-vite` build済みJSがある、**when** prepared JSとしてhostへ渡す、**then** 入力成果物hashを保存し「preloadの厳密互換」や「元TSをランタイムが直接解釈」と表示しない。
- [ ] **T1 Given** Moji v1.0.5原本TS/preloadと固定toolがある、**when** build-only `electron-vite build` と別のtypecheckを実行する、**then** original hash、lockfile/tool version、生成JS/renderer hashとtypecheck/emit結果をそれぞれ記録する。
- [ ] **T2 Given** 非対応decorator/alias/`.mts`/動的require/`node:` external/.node moduleがある、**when** build/preflight/runtimeに到達する、**then** 該当symbolまたは位置付きの認識可能なエラーで停止し、隠れたNode fallbackを使わない。
- [ ] **E1 Given** QuickJS 2026-06-04とElectron oracle pinがある、**when** CJS/Promise jobs/timers/throw/sync getter/Window eventsを実行する、**then** 対象APIの戻り値とorderを比較可能なtraceで記録でき、GC root / timeout / crashをboundedに扱う。
- [ ] **S-strict Given** 公開WKWebView初期backend、**when** 厳密同期`contextBridge`を要求する、**then** `electron-nodeless-v1`は `blocked`/`compatible:false` のまま、一般的なpreload同期関数を許可しない。
- [ ] **S-adapted Given** `WKScriptMessageHandlerWithReply` とpage API allowlistがある、**when** mainframeから認可済みPromise呼出を行う、**then** nativeがframe/doc/origin/grant/argsを確認しPromiseを完了する。同期disposerはpage内だけに閉じ、権限I/Oの同期返却はしない。
- [ ] **S-negative Given** iframe、page DOM偽装、古いdocument、任意channel、過大payload、非認可file pathがある、**when** 直接native handlerまたはpage wrapperへ要求する、**then**特権処理を実行せず明示エラーを返し、元のdocumentに権限が残らない。
- [ ] **M1〜M3 Given** Moji v1.0.5のsource hashが固定されている、**when** sample表示→編集→openDialog→saveAs→再オープン→quitを実機で実施する、**then** テストMarkdownのbytesと代表操作のtraceが一致し、`preload adapted`等の差異と除外機能をリスト化できる。認定は `App Scenario Supported` に限る。
- [ ] **N1 Given** clean macOS arm64に署名済み成果物がある、**when**起動・主要操作・終了を監査する、**then** Node/libnode/Node-API/Electron/CEF/隠れたBun/Denoが同梱・リンク・spawn・自動取得されない。
- [ ] **P1 Given** 同一revision/CPUのElectron版とNode-less版がある、**when**releaseで比較測定する、**then** compressed/installed bytes、総取得、cold/warm起動median/p95と全関連processのメモリ、終了残存が記録される。

## テスト計画

| 検証 | 実行手段 | 判定と未実行の扱い |
| --- | --- | --- |
| 実Node版回帰 | 既存 `moon check --target js` / `moon test --target js` / `moon test --target native` / `npm test` | PR #2 / 現行 profile にのみ有効。Node-lessの証拠ではない |
| QuickJS N1a | 新規 `bridges/embedded-js/` C FFI、CJS/TS golden/negative fixture（新規コマンドは実装時に固定） | J1/T1/E1。module identity、Promise、GC、event loop/timeout |
| adapted N1b | WKWebView `atDocumentStart` のpage-world API、`WKScriptMessageHandlerWithReply` native checks のmacOS実機E2E（新規） | S-adapted/S-negative、frame/doc/origin/grantと汚染/リロードを攻撃 |
| strict の状態 | `compatibility/nodeless-targets.json` と [既存M0 negative probe](https://github.com/f4ah6o/electron.mbt/blob/feat/m1-native-host-contract/docs/0003-m0-contextbridge-feasibility.md) | strictは常に `compatible:false`、証明前にPASSを出さない |
| 上流アプリ | [Moji v1.0.5](https://github.com/alexishida/Moji/tree/b7b1d585d61772a0f791f165c8d07a420443b65b)、[jmd v0.2.3](https://github.com/jojonki/jmd/tree/f875fc616feb89ea803a0fc140ec770a2ade041e) のタグ+commit fixture | M1〜M3/J1、原本/変換source hash、差分と除外操作 |
| 配布と性能 | Nodeなし実機、link/bundle/process audit、同一app Electron比較 | N1/P1。未実施をPASSとしない |

**現時点:** 全Node-lessテストは未実行。新コマンド・性能測定結果・互換認定を捏造しない。

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
- 2026-10-11: ADR-0001でQuickJS採用、strict No-Goとadapted境界、Moji/jmd実アプリpinを固定。受入シナリオを分離。

## 注記

- **状態:** `open`。engine/実アプリ/strict初版No-Goの設計判断は確定。N0依存symbol inventory、N1a QuickJS FFIとN1b-adaptedの実機security gateは未検証。段階別に着手可能だが製品互換性は未認証。
- **現在の編集ブランチ:** `devin/1791702808-node-less-roadmap`（Draft PR #3）。将来の実装用候補は`feat/nodeless-engine-probe`、`feat/nodeless-sync-bridge`であり、作成済みではない。
- **保留理由/再開条件:** strict profileは設計上blockedのまま。adaptedのnative authorizationがFAILならそちらもblocked。失敗fixtureと修正策のsecurity review後に再開し、当Issueをopenのまま維持する。
- **既存との差異:** Node版の`npm test`、macOS probe、Electron oracle PASSはこのIssueのN1b・Node-less合格ではない。`main`/PR #2と他リポジトリは今回編集しない。

## 未解決の質問

1. Moji v1.0.5 のbuild outputに残る `electron-updater`、`node:fs` / `path` / `url`、app/IPCの完全な呼出symbolとCJS module解決条件は何か。**N0で実物をinventoryする**。
2. `WKScriptMessageHandlerWithReply`を使ったadapted APIのnative frame/origin/document/grant検証とclose/reload revokeが攻撃的実機E2Eに合格するか。**未実行**。失敗したらadaptedをblockedとする。
3. Mojiの初期受入操作が `webUtils.getPathForFile` などの除外した同期関数、保存権限/設定、`electron-updater` import なしに満たせるか。構造的に必要なら明示的に見直し、adapter差異を記録する。
4. QuickJSソース/ビルドのSHA256、FFI callback/GCと更新責任、実機比較の基準値はN1a/N5で実証する。

**決定済み:** engine QuickJS 2026-06-04、初版strict sync bridge No-Go、adapted profile、Moji v1.0.5 / jmd v0.2.3 は [ADR-0001](../../docs/adr/0001-nodeless-macos-runtime-decisions.md) / [registry](../../compatibility/nodeless-targets.json) で固定。

## 詳細仕様・受入台帳（元の内容を保持）

### 1. 目的と満たすべき成果

既存の JavaScript / TypeScript 製 Electron アプリについて、**ユーザー環境で Node.js を実行・リンク・同梱せず**、対象を明示した Electron API サブセットで起動から代表操作・終了まで実行する。MoonBit は lifecycle / policy / IPC contract / diagnostics を所有し、既存 JS を MoonBit ソースへ変換することを必須にしない。

「Node-less」は **JavaScript-less ではない**。Main の JavaScript 実行には **QuickJS 2026-06-04（初期採用決定）** を使い、renderer は OS WebView を使う。strict同期bridgeは初版非対応で、許可済みPromise APIのadapted rendererを独立提供する。実 Node runner は現在の別 profile に残す。Node API と Electron API の完全互換、V8/Node-API native addon、Chromium の完全互換は目標に含めない。

本 Issue は Roadmap 0002 の **JS/TS 実アプリ実行に関する実装受入条件**であり、現行 `AGENTS.md` / Issue 0001 の Node 前提を上書きしない。Node-less設計判断はADR-0001で固定し、PR #2 の既存作業を破棄・変更しない。実装前にAGENTSのNode-less適用範囲を別差分で承認する。

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
                    embedded JS main runner (QuickJS 2026-06-04 selected)
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
2. **Main JS engine:** QuickJS 2026-06-04に初期採用を固定。MoonBit FFIで例外、GC root、callable identity、callback lifetime、thread affinity/資源制限を試験し、vendor SHAをN1aで固定。適合しなければADR改訂。ES準拠率のみでNode互換と主張しない。
3. **CJS loader:** `require('electron')`、`module.exports`、`exports`、相対解決、`__dirname`/`__filename`、循環参照、cache、module identity、JSON module、`package.json.main` を対応範囲ごとに試験する。`exports`/condition/import/dynamic require の非対応経路は安易に別パッケージへ解決せず診断する。
4. **Node shim:** `path`、`events`、`process`、必要に応じて `Buffer`、`fs` 等の **使用 symbol 単位**で提供する。filesystem/clipboard/dialog/shell に権限・パス正規化・symlink・origin 対策を設ける。未対応 `node:` built-in、`.node`、`child_process`、`worker_threads`、任意 network/stream を fail-closed にする。
5. **JS jobs と native loop:** Promise microtasks、host async I/O、timer、`process.nextTick`（もし公開するなら）と event emitter の順序を Electron oracle と差分化。native UI thread で任意 JS を待たない。同期 getter を Promise に置換しない。再入・shutdown・host loss を検証する。
6. **Preload:** WKWebView の隔離 world と page world は main runner とは別の JS realm。main 用 CJS loader をそのまま preload に渡さない。document-start で実 preload をロードし、renderer に Node globals や無制限 IPC を公開しない。
7. **Strictとadaptedを区別:** strict同期`contextBridge`は初版No-Goで`electron-nodeless-v1`をblocked。別の`electron-nodeless-adapted-v1`はpageWorldの監査済みPromise APIとpage内disposerに限定し、native frame/origin/document/grant/limitを検証する。共有DOMやpage可読tokenを特権認証にしない。原本preload任意closureの同一実行は主張しない。
8. **互換状態:** native-only MoonBit デスクトップが動作しても Electron-compatible とは表示しない。`compatibility/nodeless-manifest.json`（提案）に profile とソース hash、engine・OS・WebView・Electron oracle を記録。Node 版の既存 manifest を自動で verified にしない。

### 4. TypeScript の build-only パイプラインと失敗条件

- 候補は **バージョン固定した esbuild 等の build-time transformer**。変換・bundle は配布前に実行し、生成結果・tool version・変換設定・ソース/出力 hash・sourcemap を収集する。tool も Node runtime も製品 artifact に含めない。
- 型チェックは transpilation とは別。`tsc --noEmit` などの結果を別に記録し、`transpile PASS` を `typecheck PASS` と表示しない。
- `tsconfig.json` の対象範囲（`target`、`module`、`moduleResolution`、`paths`、`baseUrl`、JSX）、`.cts`/`.mts`、TSX、decorators、トップレベル await、dynamic import、`package.json.exports` を **機能単位の matrix** に固定する。
- 変換により `require('electron')`、module identity、isolated preload 初期化順、同期 API とイベント順序が変わるケースは unsupported/FAIL。Node built-in の bundler external 化で本番に未実装 `require('node:fs')` が残る場合は **preflight FAIL** とする。
- 原本プロジェクトがすでに `dist` を含む場合は B を優先して、存在しない `.ts` 構文をランタイム対応と誤認しない。build 時変換が必要な場合は C の変換レポートを必須にする。
- ビルドだけで判明する制約と、動的 `require` 等で実行時に初めて判明する制約を分ける。静的診断の green だけで App Compatible を宣言しない。

### 5. 実装の順序と出口

- [ ] **N0: pinned targets inventory** — ADRとMoji v1.0.5/jmd v0.2.3のcommitを固定済み。実source/buildの依存symbolとallowlist、原本/生成hash、Electron oracle fixture、adapted差分を確定する。
- [ ] **N1a: embedded engine probe** — CJS fixture + simple TS transformed fixture、microtask/timers/throw/listener identity、native transport と Sync BrowserWindow の trace を確認する。
- [ ] **N1b-adapted: native-validated async bridge** — allowlisted Promise calls、document-start page stub、frame/document/origin/grant、DOM/iframe/reload/権限/超過payloadの負例をmacOS実機で評価。strict同期bridgeを成功扱いしない。
- [ ] **N2: native-only vertical slice** — Node 不在の macOS native launcher で WebView 表示/操作/close/quit と OS cleanup を確認する。
- [ ] **N3: source-preserving CJS facade** — A/B の `require('electron')`/Node shim と IPC/preload の production wiring、C の TS build pipeline + fail-closed preflight を接続する。
- [ ] **N4: real app adapted acceptance** — Moji v1.0.5のM1〜M3操作とjmd J1を実機で検証。表示は`App Scenario Supported (adapted preload)`に限定し、厳密なElectron`App Compatible`と呼ばない。
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

各 fixture について **実行コマンド、OS/SDK/CPU、tool/engine/Electron version、PASS/FAIL/未実行、source/hash、evidence** を保存する。macOS native E2Eの代わりにLinux unitを使わない。strict profileはblockedのまま。adaptedは独立の安全性testにPASSしなければblocked。

### 7. 今回の設計 PR と実装着手の線引き

本 Issue と Roadmap 0002 を review できることが今回の完了条件。**実装・E2E・release ビルド・サイズ計測は未実施**。今後の子 Issue は N1a、N1b、N2、N3、N4/N5 に分割可能。Main の Node-less 実行に成功しても、同期 contextBridge のブロックを解消するまで `electron-nodeless-v1` は互換済みにしない。

#### 参考

- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)
- [QuickJS](https://bellard.org/quickjs/)
- [esbuild TypeScript](https://esbuild.github.io/content-types/#typescript)（typecheck ではないこと、tsconfig/emit 制約を参照）
- [esbuild Build & Bundle](https://esbuild.github.io/getting-started/)
