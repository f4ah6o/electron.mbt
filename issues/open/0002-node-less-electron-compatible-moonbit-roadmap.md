# 0002: Node-less Electron 互換ランタイムの Roadmap

Status: open
Model: GPT-6
Created: 2026-10-11
Updated: 2026-10-11
Branch: devin/1791702808-node-less-roadmap

## 概要

**種別:** アーキテクチャ設計・実現性調査の親Issue（実装そのものの完了Issueではない）。**優先度:** N0/N1の安全性・実現性ゲートを最優先。**利用者への影響:** Node実行環境を必要としない軽量配布を目指すが、現時点で利用可能なNode-lessアプリも性能・軽量化実測も存在しない。

macOS / Apple Silicon を初期対象として、MoonBit native host + OS WebView + 組み込みJavaScriptエンジンの組合せで、既存Electronの対応済み部分だけを再現する。Electron/Node版と別の適合証跡を持つ。詳細なJS/TS実行仕様は[Issue 0003](0003-nodeless-existing-js-ts-runtime.md)を参照。

## 背景

- [Issue 0001](0001-electron-compatible-lightweight-runtime.md)および`AGENTS.md`の現行方針は**実Node.jsを使う互換ランタイム**であり、このRoadmapを追加しただけで置換・終了したことにはならない。
- 既存`core/runtime.mbt`、`core/validation.mbt`は状態・権限・要求管理の再利用候補。`bridges/node/cjs-loader.cjs`は`node:module`、`bridges/node/sync_channel.c`はNode-APIに依存し、Node-less製品へそのまま移植できない。
- `main`の`cmd/electron-mbt.cjs`はNode製の診断CLI。通常`run`/`pack`はM0ゲートを理由に失敗する。PR #2には別ブランチで実験的macOS M1があるが、PR #3に取り込まれた、あるいは完成したとは扱わない。
- OS WebViewを使ってChromium同梱を避ける方針と、Node.js実行依存をなくす方針は別々の成果。後者だけでElectron APIやnpmの互換性が得られるわけではない。

## 問題

1. 一般のElectron mainはNode API/モジュール解決/イベントループに依存する。`node`だけ除去しても既存JS/TSアプリは動かない。
2. QuickJS等のmainエンジンとWKWebViewのisolated preload/page realmは独立しており、mainのJS実行が成功しても安全な同期`contextBridge`が成立するとは限らない。
3. 既存コード・既存配布アセット・TypeScript変換後アセットを混同すると、互換性と軽量化を誤って報告してしまう。
4. 現時点でNode-less用の実アプリ基準、符号化できるAPI集合、隔離と送信元認証、Node不在配布の証明方法がまだ確定していない。

## 目標

1. `moonbit-native-v1`（MoonBitで新規mainを書く）と`electron-nodeless-v1`（対応範囲内の既存JS/TS）を**独立の互換プロファイル**として仕様化する。
2. N0で対象アプリ・固定リビジョン・代表操作・依存記号・対応外設定・参照Electron環境を記録し、N1のGo/No-Go基準を決める。
3. N1でJS engine / MoonBit FFI /同期native transportを検証し、特に**公開WKWebView APIだけで安全な同期contextBridge**を満たせるかを実測する。
4. N2〜N5でNode-less native vertical slice → 既存CJS/ビルド済みJS/限定TS互換 → 実アプリ操作 → Node不在配布・比較測定の順に進める。Windows/LinuxはN6の別OS検証にする。

## 対象外

- Node.js全API、任意npmパッケージ、Node/V8 ABIや`.node` native addonの全面互換。
- Chromium/DOM/Blinkの再実装、JavaScript全体をMoonBitソースへ静的変換すること、mainのESMを初期から無変換実行すること。
- Electronバイナリ/ASARの無改修流用、`nodeIntegration:true`、`sandbox:false`等を使った暗黙の安全性低下。
- PR #2の既存Nodeホスト、mainブランチ、別リポジトリの無断変更。単一デモの成功をElectron完全互換と呼ぶこと。

## 提案する方針

| 責務 | 編集・追加候補（存在するものと新規予定を区別） | 契約 |
| --- | --- | --- |
| MoonBit共通状態 | 既存`core/runtime.mbt`・`core/validation.mbt` | lifecycle、document generation、grants、bounded pending、診断。Node版のverifiedを流用しない |
| mainエンジン | 新規候補`bridges/embedded-js/` | QuickJSを第一比較候補に、JS関数/Promise job/エラー/GC寿命とnative FFIを判定。代替候補との比較はN1で決める |
| native host | 新規Node-less launcher/`platform/macos/` adapter | AppKit/WKWebView、OS実測frame/document、private transport、UI thread ownership |
| source loader | 既存`bridges/node/cjs-loader.cjs`・`tests/loader.test.cjs`を仕様参照、新規embedded CJS loader | package main、`require('electron')`、同一module identity、cycle/cache、限定Node shim |
| TSビルド | 新規build-only adapter/fixtures。詳細はIssue 0003 | 入力JS/CJS、既存JS成果物、TS/TSX変換を区別。型検査とemit、source hashとartifact hashは別記 |
| 互換台帳 | 新規候補`compatibility/nodeless-manifest.json`、既存`compatibility/manifest.json`は保持 | profile・version・API/値型/fixture・evidence・unsupported。現行`compatible:false`を勝手に変更しない |
| oracle/検証 | 既存`fixtures/oracle/`、`scripts/oracle.cjs`、`platform/macos/WKWorldProbe.m`を比較参照 | Electronは**テスト用**に許容。本番には含めず、WK world probeは同期proxyの証拠にしない |

**開発方式:** 独立した細かい差分（N0 ADR → N1a JS engine → N1b bridge → N2 → N3...）で進める。OS公開APIの制約を迂回するためにpage DOM、page可読nonce、無認証スクリプト、private WebKit API、すべてをasync化するproxyを使わない。N1bで不成立なら`electron-nodeless-v1`はblocked、別profileは別の受入条件で扱う。

## 受け入れ条件

- [ ] **N0 Given** PR #2のNode方式と提案Node-less方式が併存する、**when** ADRを作成してレビューする、**then** 両profileの依存と`AGENTS.md`変更条件、対象アプリのrevision・主要操作・必要なNode/Electron symbol/unsupportedを列挙できる。
- [ ] **N0 Given** CJS、prepared JS、TS sourceの3入力系統がある、**when** 同一アプリのinventoryを行う、**then** JS配布アセット無変更かbuild-time生成かをsource/asset hashとともに独立に説明できる。
- [ ] **N1a Given** 同一CJS fixtureとpinned Electron oracleがある、**when** 組み込みengineとMoonBit/FFI上でCJS/Promise/timers/errors/module identityを実行する、**then** 実行trace差分・未対応機能・GC/例外/再入/timeoutの結果を再現可能に記録できる。
- [ ] **N1b Given** preloadがdocument-startに隔離注入される、**when** page初回script、同期return/throw、Promise、callback、reload、iframe偽装を実行する、**then** 同期性・権限・sender/frame/documentがoracle条件と一致し、DOM偽装で特権操作を誘発できない。成立しなければ**blockedと理由を記録**する。
- [ ] **N2 Given** Nodeを実行できない環境がある、**when** MoonBit native-onlyサンプルを起動しwindow操作して終了する、**then** Node実行/リンクを必要とせず、ウィンドウと子プロセスが残らない（まだElectron互換とは表示しない）。
- [ ] **N3 Given** N1bがpassし対象symbolが固定される、**when** 既存CJS/main/preloadとTS変換済みappを動かす、**then** 元のソース/必要に応じた生成アセットhashを保持し、対応APIだけが実行でき、未知のNode built-inやnative addonは失敗として報告される。
- [ ] **N4 Given** N0で選んだ実アプリrevisionがある、**when** 主要操作・保存・再起動・終了をElectronと同条件で行う、**then** 対象シナリオ・未対応操作・権限/IME/アクセシビリティの差を含む限定的な`App Compatible`判定を出せる。
- [ ] **N5 Given** 同一アプリの署名済み製品配布物がある、**when** NodeなしのmacOS実機で動作・起動監査・Electron比較を実施する、**then** node/libnodeの混入なし、配布サイズ・初回取得・全関連processメモリ・cold/warm起動実測を環境付きで提示できる。
- [ ] **N6 Given** macOSの互換実績がある、**when** WindowsまたはLinuxへ追加する、**then** 各OSでエンジン、WebView、sender/bridge、IME、配布依存について独立の試験を要求し、macOSの証跡を転用しない。

## テスト計画

| 対象 | 実行方法 / 証跡 | 判定基準 |
| --- | --- | --- |
| 既存Node契約の回帰 | 実在する既存コマンド`moon check --target js`、`moon test --target js`、`moon test --target native`、`npm test`。LinuxとmacOSのCIを分離 | 実行済みのみPASS。Node側PASSをNode-less合格と呼ばない |
| 新規engine/loader/TS検証 | N1aで追加する`fixtures/nodeless/`と決定論的テスト（**スクリプト未実装・コマンド未定**） | CJS cache/cycle、TS変換の実出力、Promise job順序、例外の正負ケース、original hash |
| 同期bridgeとセキュリティ | N1bで追加するmacOS AppKit/WKWebView実機probe。`fixtures/oracle/`のElectron baselineと比較 | 同期return/throw、callback、Promise、copy/freeze、page偽装・iframe・reload時の拒否をすべて証拠化 |
| 配布と軽量化 | N5で独立したclean macOSを使用しbundle inventory、link deps、process tree、実測を保存 | Nodeのない製品実行、全process計測、cold/warm median/p95。engine単体サイズで代用しない |

**現状:** このIssueは設計のみ。新しいengine、TS build adapter、native E2E、署名、互換実績、性能計測は**未実行**。新規コマンドは実装時に固定し、未作成のものを既存コマンドと表記しない。

## リスク

- **致命的:** 公開WKWebView APIでは同期`contextBridge`と安全なページ起点認証が同時に成立しない可能性。未達時に互換成功と表示しない。代替backend調査は新しいADRで費用・配布サイズ・セキュリティを比較する。
- **高:** Node shimのイベントループ順序、npm依存による動的require、QuickJSのV8/Node API非互換、FFIのGC rootとcallback寿命。
- **高:** BrowserEngine/JS realm間の認証、異なるframe・documentへの誤送信、symlink/root escape、境界値型と巨大payload。
- **中:** 変換済みTSやesbuildのランタイム残存、GPL/ライセンスやengine更新対応、OS WebView差異、gpui adapterの未完成、実アプリ選定と評価対象の偏り。
- **変更履歴・配布:** profile名、元ファイル/生成ファイルのprovenance、移行・rollback、SBOM/署名/更新責任、破壊的に既存userDataを上書きしない制約をADRに記録する。

## 変更履歴

- 2026-10-11: Node-less提案ロードマップをDraft PR #3に追加（初期版）。
- 2026-10-11: JS直接実行 / ビルド済みJS / build-only TSを分け、Issue 0003へ接続。
- 2026-10-11: `polish-issue`に従い実装境界、Given/When/Then、検証分類、リスク、保留条件を追記。**互換性の達成は主張しない**。

## 注記

- **状態:** `open`。調査/設計は開始可能だが、N0の対象アプリとprofile承認、N1bの安全な同期bridgeの成立が未確定。実装全体を`polished`にはしない。
- **現在の編集ブランチ:** `devin/1791702808-node-less-roadmap`（Draft PR #3）。将来の機能実装は`feat/nodeless-n1-engine`、`feat/nodeless-bridge`等に細分化する構想であり、ブランチ作成は未実施。
- **影響範囲:** 利用者向け配布なし（現時点文書のみ）。本Issueの受入対象は親ロードマップの設計・調査の終了条件であり、実行環境の完成判定はN0〜N5の実測後。
- **保留理由と再開:** N1bを安全に実現できない場合は`open`を維持し、negative fixture、失敗の再現手順、代替方式ADRを記録。再開条件は権限分離を損なわない代替architectureの検証。復帰先は`issues/open/0002-node-less-electron-compatible-moonbit-roadmap.md`。

## 未解決の質問

1. 対象となる具体的な実Electronアプリ、revision、利用許諾、代表操作はどれか。N0で選定するまでは全アプリ互換を目標値として固定しない。
2. 公開WKWebView APIだけで同期return/throwと`WKContentWorld`間のorigin/frame/document起点認証を安全に両立できるか。N1bの実機probeでGo/No-Goを判定する。
3. QuickJSと代替エンジンのFFI/Promise job・例外・セキュリティ更新と相対的な配布コストはどう比較されるか。N1aで実測し選定する。
4. Node shimの許可symbol、TS transformerの対応構文と対象プロファイルの互換要件はどこまでか。N0でアプリ依存を棚卸しした上で決める。

## 詳細仕様・ロードマップ（元の内容を保持）

### 1. 結論と既存方針との関係

**MoonBit native host + OS WebView + 小さな組み込み JS engine による、Node.js 非依存の Electron サブセット互換**を目指す。新規アプリ用の MoonBit API と、既存 main/preload を扱う Electron facade は同じ MoonBit core を使う。ただし、MoonBit で新規アプリが書けることと、既存 Electron アプリが無改修で動くことは別の成果とする。

Electron の main は Node.js 環境なので、Node を取り除いただけでは一般の Electron アプリは動かない。[S1] Node API 全体の再実装から始めず、Node 組み込み依存が少ないアプリを選び、必要な API の有限集合を明記して広げる。既存 TypeScript は本番ランタイム内で解釈せず、ビルド時に JavaScript へ変換するモードを設ける。最初から全 npm / Electron 互換を約束しない。

Issue 0001 と `AGENTS.md` の現行実装方針は「実 Node.js を使う」である。本 Issue はその**変更候補となる別プロファイルの提案**であり、0001 の残作業を削除・完了扱いにしない。この文書の追加だけでは実装方針を変更しない。実装着手前に N0 の ADR で承認を得て、0001 との共存・置換範囲と `AGENTS.md` の適用範囲を明示的に更新する。Node 版の成功を Node-less 版の実績へ転記しない。

### 2. Node-less と互換性の定義

#### 必須条件

1. 利用者向け launcher、host、main runner、preload の実行に Node executable / libnode / Node-API を必要としない。system Node の検出・起動・自動取得も行わない。
2. Electron、CEF、固定 Chromium を隠して同梱しない。OS WebView の共有 runtime は依存として明示する。
3. JS engine 自体は禁止しない。既存 JavaScript の実行には必要であり、Node-less は JavaScript-less / engine-less / 全コードMoonBit製を意味しない。
4. 開発時の bundler、既存 Node adapter の回帰試験、別配置の Electron oracle は Node を使用してよい。製品の実行時依存と区別し、Node-less な build toolchain は初期必須にしない。
5. 未対応 API は診断または利用時に明示的に拒否する。Node fallback、ソースの書き換え、同期 API の Promise 化、隔離の無効化で成功を装わない。

#### 公開する二つの成果

| 提案プロファイル | 対象 | 表示してよい成果 |
| --- | --- | --- |
| `moonbit-native-v1` | main を MoonBit で書く新規アプリ | Node-less desktop runtime。これだけでは Electron source-compatible と呼ばない |
| `electron-nodeless-v1` | 対応範囲内の既存 CJS、ビルド済み JS、ビルド時変換する TS/TSX | 入力モードと変換有無を明示し、固定 Electron / app revision / OS / engine / API 集合に対する限定互換 |

名称は提案であり、現行 manifest の `desktop-core-v1` を変更しない。直接 CJS 実行の「配布アセット無変更」の判定では main/preload と renderer 配布アセットのハッシュ一致を要求する。一方、TypeScript ビルド時変換では入力ソースのハッシュ一致と生成 JS のハッシュを別々に記録し、「原本ソース無改変」と「配布アセット無変更」を混同しない。launcher / 設定の変更は別記する。再bundleしたアプリを既存配布物の「無改修起動」とは呼ばない。

#### JS/TS の入力モードと build-only 方針

[実装 Issue 0003](0003-nodeless-existing-js-ts-runtime.md) で入口と受入条件を固定する。最初から全ての `.ts` / ESM を直接実行できるとは表示しない。

| モード | 入力 | Node-less runtime の挙動 | 成果表示 |
| --- | --- | --- | --- |
| A: Direct CJS | 既存 `main.cjs` / `preload.cjs` / pure JS 依存 | 組み込み engine の CJS loader がそのまま評価 | 原本・既存 renderer アセットの hash が一致した範囲の無改変実行 |
| B: Prepared JS | 既存アプリに同梱済みのビルド成果物（TS 製アプリを含む） | 成果物 JS を A と同じ engine で評価 | 既存 JS 配布アセットの無変更実行。元 TS の解釈とは称しない |
| C: TS build | `.ts` / `.cts` / `.tsx` 等 | ビルド時に型構文除去・transpile / 必要な場合 bundle した JS を評価 | 入力ソースの無改変と生成アセットの変更をそれぞれ記録 |

C の build-time 変換器は pin した esbuild 等を候補とし、本番パッケージには同梱しない。ビルド時に Node を使用することは許容するが、利用者の環境に Node executable / libnode / Node-API を要求しない。`tsc --noEmit` 等の型チェックと transpilation は別工程で別判定とする。[S7] `tsconfig` の path alias・JSX・decorators・`.mts`・動的 import / require・bundler の external 処理は機能ごとに対応/拒否を定義する。未実装 Node built-in を external として残しただけの成功を互換扱いしない。

### 3. 現在地と再利用の境界

[README](../../README.md) と実装台帳にあるとおり、現状は M0 途中で `run` / `pack` は明示的に失敗する。BrowserWindow や完全な preload/IPC はまだ接続されていない。

| 既存資産 | Node-less 版での扱い |
| --- | --- |
| `core/runtime.mbt`、`core/validation.mbt` | lifecycle、ID、generation、grant、bounded request の契約を再利用。実 OS 接続済みとは見なさない |
| `bridge/bridge.mbt` | core 境界の参考。現在の CJS export を native FFI と同一視しない |
| `bridges/node/cjs-loader.cjs` | `node:module` に依存するため、そのまま再利用不可。module identity 等の期待値を別 engine の loader 試験へ移す |
| `bridges/node/sync_channel.c` | Node-API probe は製品依存にできない。framing / timeout 等の契約を参考に、必要なら C ABI の独立 transport を用意 |
| Node の codec / inventory / CLI | 契約・negative test は活用。Node built-in 依存を棚卸しし native core / adapter に移す。tiny tree codec は Structured Clone 互換ではない |
| `platform/macos/WKWorldProbe.m` | world 分離の probe を拡張。同期 function proxy の証明にはならない |
| `fixtures/oracle/`、`scripts/oracle.cjs` | Node/Electron を使う独立した参照環境として残す。製品には含めない |

### 4. 提案アーキテクチャと先行技術判断

```text
MoonBit native main ───────────────────────────┐
既存 main.cjs / prepared JS ────────────────────┤
既存 main.ts / main.tsx -> build-time transform ┤
                                               v
          embedded JS runner -> MoonBit core / host services
          CJS + electron      lifecycle / policy / IPC / diagnostics
          facade                        |
                                OS window + system WebView
                                         |
                            isolated preload <-> page / Web UI
```

- MoonBit が契約・状態・権限・診断を所有する。C/ObjC/C++ は FFI、OS/engine の接続、callback lifetime 管理。手書き JS は JS 関数/listener identity 等の leaf glue に限定する。
- MoonBit native C FFI は利用候補だが、使用 toolchain を固定し、GC root、retain/release、文字列/例外変換、thread affinity、終了時 callback を検証する。[S5]
- **main の engine の第一検証候補は QuickJS**。C embedding と複数 OS への展開を評価する。[S6] macOS の JavaScriptCore は比較候補。採用は N1 の証拠で決め、性能・互換・配布サイズを未測定のまま断定しない。
- main の engine と WKWebView の JS realm は別物。engine を選んでも preload の DOM アクセスや world 間の同期 bridge は解決しない。preload を main runner で評価して代用しない。
- main runner の別プロセス案を先に検証し、native UI thread の ownership を維持する。同期 main API に必要な private transport、再入、close キャンセルを含めて N1 で成立性を判定する。同一プロセス案への変更も ADR を通す。
- Window adapter は既存設計の gpui 境界を検討するが、未接続の gpui 実装があるとは仮定しない。probe の AppKit 直結を製品構成へ採用する場合は依存と所有権を ADR に記す。他リポジトリへの変更は本 Issue の範囲外。
- 独自 JS interpreter、DOM、ブラウザ、Node 全体は作らない。Bun / Deno を隠れた代替必須 runtime として採用しない。

### 5. 最初の互換サブセット

以下は実装予定であり、対応済みの一覧ではない。オプション・値型・失敗経路まで N0 の matrix で固定する。

| 領域 | 最初の対象 | 初期の境界 |
| --- | --- | --- |
| app | `whenReady`、ready / activate / window-all-closed、quit とキャンセル | OS ごとの順序差を oracle で比較 |
| BrowserWindow | constructor、loadFile、許可した loadURL、show/hide、close/destroy、基本 getter、webContents の最小部分 | 同期戻り値を未確認キャッシュで捏造しない |
| preload | document-start、限定 `require('electron')`、隔離 world | main の CJS loader を preload にそのまま公開しない |
| contextBridge | exposeInMainWorld、copy/freeze、同期 return/throw、Promise、関数 proxy | N1 の blocking gate。限定値型でも同期性・隔離を維持する |
| IPC | ipcMain.handle / ipcRenderer.invoke、send/on/removeListener、webContents.send | channel / sender / generation / lifetime / clone を別々に検証。sendSync は対象外 |
| OS services | 非同期 open/save dialog、text clipboard、許可した URL の openExternal | ファイルを読む処理は別の Node shim または MoonBit service。dialog だけで fs 互換としない |
| CJS main | `require('electron')`、明示したローカル JS/JSON と pure-JS 依存の解決 | cache、cycles、exports/module.exports、相対パス、identity を試験。package exports 等は個別に範囲決定 |
| Node compatibility island | 実アプリで必要な `path` / `events` の小集合と `process.platform` 等を候補にする | 自動的に「全 path/events/process 対応」としない。CJS の `__dirname` / `__filename` も契約化 |
| TS build adapter | `.ts` / `.cts` / `.tsx` から engine 対応 JS/CJS への変換、provenance、sourcemap | 型チェックは別判定。ネイティブ addon や未実装 Node built-in、未対応 ESM/TS 設定は fail-closed |
| Web | OS WebView の HTML/CSS/DOM/ブラウザ JS | Chromium 完全互換は保証しない。origin/CSP/storage の差は公開する |

`fs` / `fs.promises`、Buffer、timers、queueMicrotask 等は必要性を N0 で棚卸しする。最初の fixture に必要な symbol だけ N3 までに実装・比較し、残りは unsupported とする。Node の `process.nextTick` と Promise job / OS event loop の順序をブラウザ timer で近似しない。無制限な Node polyfill の追加を避け、shim を追加するたびに依存・保守・権限のコストを記録する。

初期非対応: native addon（Node-API を含む）、child_process、worker_threads、任意の Node network / stream API、全 Node module resolution、main ESM、ASAR、autoUpdater、Chromium extensions/CDP、nodeIntegration:true、contextIsolation:false、sandbox:false、webSecurity:false、unsandboxed preload。ESM は main と preload で規則が違うため CJS 成功から推定しない。[S4]

### 6. Roadmap：期限ではなく出口条件で進める

依存順序: **N0 → N1 → N2 → N3 → N4 → N5 → N6**。N1 失敗時に「API を増やせば互換になる」として後工程へ進まない。N2 の native-only 成果は独立して価値があるが、N3/N4 の既存アプリ互換を代替しない。

#### N0 — 方針承認・対象アプリと契約の固定

- [ ] `docs/adr/` に Node-less プロファイルの境界と既存 Node 版との関係を記し、承認後に実装ガイドを整合させる。
- [ ] 実在する小規模 Electron アプリを最低1つ、revision・利用許諾・代表操作付きで選ぶ。対象外 API を試験から隠して「全機能互換」としない。
- [ ] main/preload の依存と動的 require / Node globals / Electron API を棚卸しし、fixture と symbol 単位の対応表を作る。
- [ ] A/B/C の入力モードと `tsconfig`、変換 toolchain、原本/成果物 hash の差を固定し、最低1件の限定 TS fixture を選ぶ。
- [ ] Electron oracle / source commit、MoonBit toolchain、engine、OS/SDK/WebView を固定する。既存 manifest の pin は出発点であり今回の実行証跡ではない。

**出口:** Node-less の定義、API/値型の初期集合、対象アプリ、許容設定差、unsupported 診断がレビュー可能。既存 main を改修しないと成立しないアプリしかなければ、その事実と移植版の別目標を明示する。

#### N1 — 最大リスクを先に潰す feasibility probes

- [ ] 組み込み engine で CJS fixture と Promise job / timer / error / listener identity を実行し、native event loop との接続を記録する。
- [ ] 同一機能の TS fixture を build-only 変換した結果と CJS 直接実行を比較し、unsupported な path alias/変換構文/Node external を明示的に拒否する。
- [ ] private transport の同期 window 操作で return/throw、nested callback、再入、UI thread deadlock、runner crash / timeout を検証する。
- [ ] 実 WKWebView の公開 API で、隔離 preload → page の同期 function proxy、copy/freeze、最初の page script より前の公開を検証する。[S2][S3]
- [ ] callback の登録/解除、Promise rejection、prototype 汚染、navigation/reload 後の古い handle、外部 frame の呼び出しを含む positive/negative test を用意する。
- [ ] QuickJS と代替候補、プロセス構成、WebView adapter の採否を ADR に記す。外部ライブラリの hello-world サイズを製品サイズとして使わない。

**出口:** 固定環境で同期・隔離の証跡が揃うこと。postMessage の async round-trip、DOM event、page 可読 nonce、private WebKit API による回避は合格ではない。

**不成立時:** `electron-nodeless-v1` を blocked とし、理由と不成立 fixture を残す。非互換の async-only MoonBit API を別プロファイルで続けるか、別 backend を調査するかをユーザーと再決定する。同期の Electron API を黙って変更しない。

#### N2 — Node に依存しない縦断的な最小アプリ

- [ ] `core/` を使う native launcher / host と `platform/macos/` adapter を追加する。Node CLI を呼ぶ wrapper にはしない。
- [ ] MoonBit main から実 window/WebView を作り、local HTML 表示、resize、close/quit cancellation、終了まで接続する。
- [ ] native sender / frame / document generation を host が観測し、loadFile の root/symlink/origin/CSP/storage を検証する。
- [ ] 提案 `fixtures/nodeless/` に再現用の最小アプリを置く。Node/Electron のない製品試験環境で実行する。

**出口:** native-only アプリの起動・操作・終了が実機で成功し、Node 起動/リンクがなく、pending request と子プロセスが残らない。まだ既存 Electron アプリ互換とは表示しない。

#### N3 — 既存 CJS main/preload と Electron facade

- [ ] 提案 `bridges/embedded-js/` に engine leaf adapter / CJS loader を置き、lifecycle を JS 側へ重複実装しない。
- [ ] app / BrowserWindow / isolated preload / contextBridge / IPC を同じ MoonBit core に接続する。N1 の probe を production 境界の試験へ昇格する。
- [ ] N0 で必要と判明した shim を明示的な allowlist で実装する。未対応 built-in / addon / import 経路は fail-closed にする。
- [ ] source/asset hash、module identity、同期戻り値、例外、必要なイベント順序を、同一 fixture の Electron oracle と差分比較する。
- [ ] TS build-only adapter を production packaging 前の段階に接続し、typecheck と transpile の証拠、変換 source map、unsupported diagnostics を分離する。

**出口:** N0 の fixture がソース・アセット無変更で動作し、対応 matrix の各行に証跡がある。新規 `compatibility/nodeless-manifest.json` 等で既存 Node profile と証跡を分離する。

#### N4 — 実アプリ受入・権限と寿命の堅牢化

- [ ] N0 の実アプリで open → 操作 → save → 再起動 → quit の代表操作を検証する。ファイル機能を持たない対象なら、そのアプリの実際の主要操作を N0 で固定する。
- [ ] dialog / clipboard / shell / 必要な file service、複数 window、listener removal、error/clone の対応範囲を埋める。
- [ ] renderer 偽装、iframe、remote navigation、symlink/root escape、巨大 payload、pending 上限、duplicate completion、host/runner/WebView crash を検証する。
- [ ] 日本語 IME、focus、コピー、DPI、アクセシビリティを実 WebView で確認する。unit test や Linux の結果で代用しない。

**出口:** 少なくとも1つの実アプリについて revision・操作範囲・設定差を添えた `App Compatible` を報告できる。特権 API は renderer へ丸ごと渡さず、公開 channel と native-attested sender で制限する。trusted main 自体を sandbox 化したとは主張しない。

#### N5 — 配布、Node 不在の証明、比較測定

- [ ] native `run` / `doctor` / `compat-check` / `pack` を整備する。静的診断は候補判定に留め、未実行分岐まで compatible と断定しない。
- [ ] package に launcher / MoonBit host / 必要なら JS runner・engine / app / production deps / manifest / license notices を含め、Node/Electron/test oracle を除外する。
- [ ] SBOM、依存ハッシュ、署名/notarization、更新責任、独立 userData と安全な切り戻し手順を用意する。autoUpdater 互換とは分ける。
- [ ] Node 未導入の clean machine で起動・主要操作・終了を確認する。PATH を空にするだけでなく、bundle inventory / link dependencies / process tree / 実行監査で libnode 同梱や動的取得がないことを検証する。
- [ ] TS 変換器、typechecker、Node 製 build tools、Electron oracle が本番 package に混入していないことを検証する。
- [ ] 同一 app/revision/機能/CPU/release 条件で Electron 版と比較する。Node 版は比較可能な成果物ができている場合だけ別系列で追加する。

測定項目は圧縮/展開サイズ、WebView 不足分を含む初回取得量、全関連 process のメモリ、起動から可視 frame / 入力可能まで、idle/操作 CPU、終了後の残存資源。cold/warm、試行数、median/p95、環境を保存する。engine 単体サイズや Node を除いた差分だけで製品の優位性を主張しない。受入予算は N0/N1 の baseline 後、製品比較の前に合意する。

**出口:** Node なしで利用できる署名済み macOS artifact、再現可能な証拠、既知の制限を含む限定リリース。サイズ・起動・メモリの改善はそれぞれ独立して判定する。

#### N6 — 適合を維持して広げる

- [ ] 次の実アプリが必要とする Menu / Tray / notification / shortcut、Node shim、main ESM を個別 Issue 化する。
- [ ] Windows WebView2 Evergreen、Linux WebKitGTK を別 backend として追加し、N1 相当の同期/隔離 gate と native E2E を OS ごとにやり直す。
- [ ] OS WebView / engine 更新ごとに differential regression を回す。最小サポート OS、WebView の初回導入・offline 依存も公開する。

native addon、完全 Node 互換、Chromium 固有 API は「あとで必ず対応する項目」ではなく、別設計と保守コストの再判断が必要な境界とする。

### 7. 実装 Issue の切り出し順序

この文書は親 Roadmap として開いたままにし、各段階の開始時に `issues/open/` へ子 Issue を作る。番号は作成時に採番する。**既存 JS/TS アプリの実行と受入条件は [Issue 0003](0003-nodeless-existing-js-ts-runtime.md) に記載済み**。N1a/N1b 等の実装単位は今後さらに分割する。

1. **N0: Node-less profile ADR + app/API inventory** — docs / fixtures / manifest の設計。方針の承認が実装開始条件。
2. **N1a: embedded JS + event loop + sync main transport probe** — engine/FFI/process の判定。
3. **N1b: WKContentWorld synchronous bridge feasibility** — 最大の blocking gate。N1a と独立に調査可能。
4. **N2: native host/launcher vertical slice** — 実 window の作成・操作・終了。
5. **N3: source-preserving CJS facade + preload/IPC** — 必要最小限の shim と oracle 差分試験。
6. **N4/N5: real-app acceptance + distribution audit** — 実操作・Node 不在・署名・測定。

各子 Issue は依存 milestone、対象 symbol/設定/値型、変更場所、negative case、実行環境、PASS/FAIL/NOT RUN の出口条件を必須とする。N1 の結果前に大量の API stub を生成しない。

### 8. 完了条件と証跡の扱い

本設計タスクの完了は本 Markdown の追加と内容レビューまで。runtime 実装、engine 採用、native E2E、互換性、軽量化の実証は**未実施**。Markdown の検査結果と runtime の合格を混ぜない。

Roadmap の runtime 完了は N0〜N5 の出口条件、実アプリ1件以上の限定適合、Node 非依存 artifact と再現可能な証跡が揃った時点。N6 は継続的拡張であり、全 Electron/npm 互換を親 Issue の完了条件にしない。検証状態は `planned` / `partial` / `verified` / `unsupported` で管理し、blocked gate と NOT RUN を明示する。

### 9. 参照資料

仕様確認日: 2026-10-11。公式 `latest` 文書は設計の参考であり、実装の適合判定では固定バージョンの仕様/ソース/実行結果を使う。

- [S1: Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model) — main の Node.js 環境と renderer/preload の役割。
- [S2: Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge) — 同期・双方向 bridge、function proxy、copy/freeze の契約。
- [S3: Apple WKContentWorld](https://developer.apple.com/documentation/webkit/wkcontentworld) — world の分離と navigation 時の寿命。同期 function proxy の保証ではない。
- [S4: Electron ESM](https://www.electronjs.org/docs/latest/tutorial/esm) / [Sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox) — main / preload の異なる loader と限定 Node 環境。
- [S5: MoonBit FFI](https://docs.moonbitlang.com/en/latest/language/ffi.html) — native C ABI、foreign types、callbacks。
- [S6: QuickJS](https://bellard.org/quickjs/) — 組み込み可能な JS engine 候補。Node / Electron API 互換を保証するものではない。
- [S7: esbuild TypeScript](https://esbuild.github.io/content-types/#typescript) — 型チェックなしの変換と `tsconfig` / TypeScript emit の制約。
