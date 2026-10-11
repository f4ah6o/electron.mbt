# 0002: Node-less Electron 互換ランタイムの Roadmap

Status: open
Model: GPT-6
Created: 2026-10-11
Updated: 2026-10-11
Branch: devin/1791702808-node-less-roadmap

## 概要

**種別:** Node-less macOS アーキテクチャの親Issue（設計決定済み・実装未実証）。**優先度:** N1a 組み込み engine と N1b-adapted の security probe。**利用者への影響:** Node なしの軽量実行を目指すが、対応アプリや性能改善の実証はない。

2026-10-11 に [ADR-0001](../../docs/adr/0001-nodeless-macos-runtime-decisions.md) で初期方式と対象を確定した。**QuickJS 2026-06-04 / macOS WKWebView / TypeScript build-only**。厳密な同期 Electron `contextBridge` は public WKWebView ベースの初版では unsupported、`electron-nodeless-v1` は blocked とする。独立した `electron-nodeless-adapted-v1` は監査済み非同期 IPC に限定し、実機 security E2E が通るまで planned / `compatible:false`。

一次対象は [Moji v1.0.5](https://github.com/alexishida/Moji/tree/b7b1d585d61772a0f791f165c8d07a420443b65b)（TypeScript）、二次対象は [jmd v0.2.3](https://github.com/jojonki/jmd/tree/f875fc616feb89ea803a0fc140ec770a2ade041e)（CommonJS）。両者の commit / 対象操作 / 除外機能は [nodeless-targets.json](../../compatibility/nodeless-targets.json) に固定した。いずれもまだ実行・互換確認していない。詳細の実装基準は [Issue 0003](0003-nodeless-existing-js-ts-runtime.md)。

## 背景

- [Issue 0001](0001-electron-compatible-lightweight-runtime.md)および`AGENTS.md`の現行方針は**実Node.jsを使う互換ランタイム**であり、このRoadmapを追加しただけで置換・終了したことにはならない。
- 既存`core/runtime.mbt`、`core/validation.mbt`は状態・権限・要求管理の再利用候補。`bridges/node/cjs-loader.cjs`は`node:module`、`bridges/node/sync_channel.c`はNode-APIに依存し、Node-less製品へそのまま移植できない。
- `main`の`cmd/electron-mbt.cjs`はNode製の診断CLI。通常`run`/`pack`はM0ゲートを理由に失敗する。PR #2には別ブランチで実験的macOS M1があるが、PR #3に取り込まれた、あるいは完成したとは扱わない。
- OS WebViewを使ってChromium同梱を避ける方針と、Node.js実行依存をなくす方針は別々の成果。後者だけでElectron APIやnpmの互換性が得られるわけではない。

## 問題

1. 一般のElectron mainはNode API/モジュール解決/イベントループに依存する。`node`だけ除去しても既存JS/TSアプリは動かない。
2. QuickJS等のmainエンジンとWKWebViewのisolated preload/page realmは独立しており、mainのJS実行が成功しても安全な同期`contextBridge`が成立するとは限らない。
3. 既存コード・既存配布アセット・TypeScript変換後アセットを混同すると、互換性と軽量化を誤って報告してしまう。
4. 実アプリのcommitと製品プロファイルはADRで選定済みだが、使用する各Node/Electron symbolの完全inventoryと、adapted bridgeの実機セキュリティ結果、Node不在製品監査は未実施。

## 目標

1. `moonbit-native-v1`（MoonBitで新規mainを書く）と`electron-nodeless-v1`（対応範囲内の既存JS/TS）を**独立の互換プロファイル**として仕様化する。
2. N0では固定済みMoji/jmdの上流 source/build outputから使用symbolとunsupportedを機械可読に棚卸しし、Oracle 44.7.0との差分項目とシナリオを確定する。
3. N1aでは採用済みQuickJSのMoonBit FFI・CJS/Promise/jobを確認し、N1b-adaptedではnative frame/document/grantsで検証する非同期APIを攻撃的実機試験に掛ける。厳密同期bridgeは初版No-Goのまま、別ADRなしに互換認定しない。
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
| mainエンジン | 新規`bridges/embedded-js/`（予定） | **QuickJS 2026-06-04 に決定**。FFI・GC/job/例外/サイズの実行検証はN1a。欠陥時の再選定だけADR改訂 |
| native host | 新規Node-less launcher/`platform/macos/` adapter | AppKit/WKWebView、OS実測frame/document、private transport、UI thread ownership |
| source loader | 既存`bridges/node/cjs-loader.cjs`・`tests/loader.test.cjs`を仕様参照、新規embedded CJS loader | package main、`require('electron')`、同一module identity、cycle/cache、限定Node shim |
| TSビルド | 新規build-only adapter/fixtures。詳細はIssue 0003 | 入力JS/CJS、既存JS成果物、TS/TSX変換を区別。型検査とemit、source hashとartifact hashは別記 |
| 互換台帳 | 新規候補`compatibility/nodeless-manifest.json`、既存`compatibility/manifest.json`は保持 | profile・version・API/値型/fixture・evidence・unsupported。現行`compatible:false`を勝手に変更しない |
| oracle/検証 | 既存`fixtures/oracle/`、`scripts/oracle.cjs`、`platform/macos/WKWorldProbe.m`を比較参照 | Electronは**テスト用**に許容。本番には含めず、WK world probeは同期proxyの証拠にしない |

**開発方式:** N0（固定済みADR＋symbol inventory）→ N1a QuickJS → N1b-adapted allowlisted Promise IPC → N2 → N3。厳密同期bridgeは初版でunsupported、`electron-nodeless-v1`はblocked。`electron-nodeless-adapted-v1`は**別仕様**として、共有DOMやpage可読nonceを認証に使わず、native sender/grant の negative E2E 合格が必要。

## 受け入れ条件

- [ ] **N0 Given** [ADR-0001](../../docs/adr/0001-nodeless-macos-runtime-decisions.md) と [targets registry](../../compatibility/nodeless-targets.json) に固定commitがある、**when** Moji v1.0.5 / jmd v0.2.3 をinventoryする、**then** CJS/TS input、各API symbol、Node built-in、build checksum、excluded behaviorとElectron oracle fixtureが確定する。
- [ ] **N1a Given** QuickJS 2026-06-04を採用済み、**when** CJS/TS出力をMoonBit FFIで実行する、**then** module identity/cycle、Promise jobs、timers、例外、GC root、timeoutの trace が実際に記録され、unsupportedは失敗する。
- [ ] **N1b-adapted Given** page world の allowlisted Promise API だけが公開される、**when** iframe/DOM偽装/reload/stale generation/過大payload/権限外のファイルを要求する、**then** native が実`WKFrameInfo`・origin・document grantで拒否し、無権限のside-effectが一切起きない。未合格ならadaptedもblocked。
- [ ] **Strict Given** 本ADRのWKWebView初期backend、**when** Electron同期`contextBridge`互換を問い合わせる、**then** `electron-nodeless-v1` は `compatible:false`・blocked で、同期関数を暗黙にPromise化しない。
- [ ] **N2 Given** macOS arm64 native launcher、**when** Nodeなし環境で起動→表示→閉じる、**then** Nodeをspawn/linkせず関連processが終了する。これだけでElectron互換とは表示しない。
- [ ] **N3 Given** N1b-adaptedのsecurity gateに合格、**when** Mojiのprepared rendererとJS mainを実行する、**then** `preload adapted` と原本/生成hashを明記し、許可済みAPIだけが動く。strict preload互換の成功を主張しない。
- [ ] **N4 Given** 固定Moji revision、**when** サンプル表示→Markdown編集→dialog open→saveAs→reopen→quitを行う、**then** scenarioごとの差分・未対応機能・security/IMEを示して **App Scenario Supported** か否かを判定できる。
- [ ] **N5 Given** 署名済み配布物、**when** Node未導入macOS実機で監査・同条件Electron比較、**then** libnode/Node実行体/Node-APIの不在と全プロセスメモリ、配布サイズ、cold/warm起動の実測が保存される。
- [ ] **N6 Given** macOSで限定的な受入結果がある、**when** 他OSを検討、**then** OS別のWebView/bridge/IME/security gateを改めて実行する。

## テスト計画

| 対象 | 実行コマンド / fixture | 判定 |
| --- | --- | --- |
| 既存Node版の回帰 | `moon check --target js` / `moon test --target js` / `moon test --target native` / `npm test`（既存） | 旧Node版のみ。新profileのPASSへ転記しない |
| N1a QuickJS | 新規`bridges/embedded-js/`、`fixtures/nodeless/`に native tests（コマンドは実装時確定） | CJS cache/cycle、jobs/timer/error、FFI lifetime、bounded resource |
| N1b-adapted | `WKScriptMessageHandlerWithReply` / `WKUserScript` と native frame/document grant の macOS negative E2E（新規） | Promise method/ローカルdisposer、初回script、iframe、DOM spoof、stale、permission denial |
| strict status | `compatibility/nodeless-targets.json` のblocked profileと既存M0診断を比較 | strict同期`contextBridge`をPASSと誤表示しない |
| Moji / jmd | pinned commitsのbuild/renderer asset hashesと実アプリ試験（新規） | Moji M1〜M3、jmd J1。対象外操作を成功としない |
| 配布と計測 | clean macOS arm64 / bundle・link・process audit / Electron oracle（新規） | Node不在・署名・サイズ/起動/メモリの独立測定 |

**現状:** これらNode-less試験は全て**未実行**。新コマンド名を捏造しない。旧CIのPASSは旧Node版の回帰に限る。

## リスク

- **致命的:** 公開WKWebView APIでは同期`contextBridge`と安全なページ起点認証が同時に成立しない可能性。未達時に互換成功と表示しない。代替backend調査は新しいADRで費用・配布サイズ・セキュリティを比較する。
- **高:** Node shimのイベントループ順序、npm依存による動的require、QuickJSのV8/Node API非互換、FFIのGC rootとcallback寿命。
- **高:** BrowserEngine/JS realm間の認証、異なるframe・documentへの誤送信、symlink/root escape、境界値型と巨大payload。
- **中:** 変換済みTSやesbuildのランタイム残存、QuickJS MIT表記と更新対応、OS WebView差異、gpui adapterの未完成、固定したMoji/jmdだけへの評価の偏り。
- **変更履歴・配布:** profile名、元ファイル/生成ファイルのprovenance、移行・rollback、SBOM/署名/更新責任、破壊的に既存userDataを上書きしない制約をADRに記録する。

## 変更履歴

- 2026-10-11: Node-less提案ロードマップをDraft PR #3に追加（初期版）。
- 2026-10-11: JS直接実行 / ビルド済みJS / build-only TSを分け、Issue 0003へ接続。
- 2026-10-11: `polish-issue`に従い実装境界、Given/When/Then、検証分類、リスク、保留条件を追記。**互換性の達成は主張しない**。
- 2026-10-11: ADR-0001でQuickJS・strict No-Go・adapted security契約・Moji/jmd pinを決定し、Roadmap受入条件を更新。

## 注記

- **状態:** `open`。engine/対象アプリ/strict bridge No-Go は決定済み。N0 inventory、N1a engine FFI、N1b-adapted native security E2E が未実施で製品互換の実装は未認証。
- **現在の編集ブランチ:** `devin/1791702808-node-less-roadmap`（Draft PR #3）。将来の機能実装は`feat/nodeless-n1-engine`、`feat/nodeless-bridge`等に細分化する構想であり、ブランチ作成は未実施。
- **影響範囲:** 利用者向け配布なし（現時点文書のみ）。本Issueの受入対象は親ロードマップの設計・調査の終了条件であり、実行環境の完成判定はN0〜N5の実測後。
- **保留理由と再開:** 初版strict profileは`blocked`。adaptedのN1b攻撃的E2EがFAILならadaptedもblocked、再開条件はnative frame/document/grantsを使う安全な方式と再現fixture。問題を別ADRで再審議。Issue path/Statusはopenのまま。

## 未解決の質問

1. Moji v1.0.5 のbuild成果物に残る `electron-updater`、Node built-in、Electron facadeの**実際のsymbol一覧**は何か。N0で固定revisionをinventoryし、必須importに対応できなければ 明示的unsupportedで停止する。
2. N1b-adaptedが現実のWKWebViewで native frame/document/grantを正しく検証し、pageからの権限昇格や古いcallbackを拒否できるか。安全性は **未証明**。攻撃的実機test合格をGo条件とする。
3. MojiのM1〜M3が同期`webUtils.getPathForFile`など対象外操作を避けて**入力ソースを改変せず**実行できるか。無理なら適応差分とNo-Goを明記する。
4. QuickJS tarballのSHA256、C ABI、FFI GC寿命・更新責任、およびElectron比較のサイズ/起動実測は未検証。N1a/N5で確定する。

**決定済み（再質問しない）:** engine = QuickJS 2026-06-04、strict同期bridge = 初版unsupported、別adapted profile採用、実アプリ = Moji v1.0.5 / jmd v0.2.3。詳細は [ADR-0001](../../docs/adr/0001-nodeless-macos-runtime-decisions.md)。

## 詳細仕様・ロードマップ（元の内容を保持）

### 1. 結論と既存方針との関係

**MoonBit native host + OS WebView + QuickJS 2026-06-04 による、Node.js 非依存の限定 Electron 実行環境**を目指す。初版は一般的な同期`contextBridge`互換を提供せず、明示した adapted renderer APIのみを対象とする。新規アプリ用の MoonBit API と、既存 main/preload を扱う Electron facade は同じ MoonBit core を使う。ただし、MoonBit で新規アプリが書けることと、既存 Electron アプリが無改修で動くことは別の成果とする。

Electron の main は Node.js 環境なので、Node を取り除いただけでは一般の Electron アプリは動かない。[S1] Node API 全体の再実装から始めず、Node 組み込み依存が少ないアプリを選び、必要な API の有限集合を明記して広げる。既存 TypeScript は本番ランタイム内で解釈せず、ビルド時に JavaScript へ変換するモードを設ける。最初から全 npm / Electron 互換を約束しない。

Issue 0001 と `AGENTS.md` の現行実装方針は「実 Node.js を使う」である。本 Issue はその**変更候補となる別プロファイルの提案**であり、0001 の残作業を削除・完了扱いにしない。この文書の追加だけでは実装方針を変更しない。実装着手前に N0 の ADR で承認を得て、0001 との共存・置換範囲と `AGENTS.md` の適用範囲を明示的に更新する。Node 版の成功を Node-less 版の実績へ転記しない。

### 2. Node-less と互換性の定義

#### 必須条件

1. 利用者向け launcher、host、main runner、preload の実行に Node executable / libnode / Node-API を必要としない。system Node の検出・起動・自動取得も行わない。
2. Electron、CEF、固定 Chromium を隠して同梱しない。OS WebView の共有 runtime は依存として明示する。
3. JS engine 自体は禁止しない。既存 JavaScript の実行には必要であり、Node-less は JavaScript-less / engine-less / 全コードMoonBit製を意味しない。
4. 開発時の bundler、既存 Node adapter の回帰試験、別配置の Electron oracle は Node を使用してよい。製品の実行時依存と区別し、Node-less な build toolchain は初期必須にしない。
5. 未対応 API は診断または利用時に明示的に拒否する。Node fallback、ソースの書き換え、同期 API の Promise 化、隔離の無効化で成功を装わない。

#### 公開する三つの区別されたプロファイル

| 提案プロファイル | 対象 | 表示してよい成果 |
| --- | --- | --- |
| `moonbit-native-v1` | main を MoonBit で書く新規アプリ | Node-less desktop runtime。これだけでは Electron source-compatible と呼ばない |
| `electron-nodeless-v1` | 任意の同期 `contextBridge` を含む厳密なElectron互換 | 初版 **blocked** / `compatible:false`。安全な同期cross-world proxyの実証前には公開しない |
| `electron-nodeless-adapted-v1` | 元JS/TS Main と、監査済みPromise IPCの**生成preload adapter**を使う既存Renderer | 未実装・予定。原本renderer/assets・build差分を明示し、`App Scenario Supported (adapted)` のみ判定する |

現行manifest `desktop-core-v1` は変更しない。**adapted profileは元preloadの任意closureを実行する厳密互換ではない。** 原本source、prepared JS、renderer配布asset、生成されたpreload surrogateを別々にハッシュ化し、`source unchanged` と `distribution unchanged` と `adapted preload` を混同しない。

#### JS/TS の入力モードと build-only 方針

[実装 Issue 0003](0003-nodeless-existing-js-ts-runtime.md) で入口と受入条件を固定する。最初から全ての `.ts` / ESM を直接実行できるとは表示しない。

| モード | 入力 | Node-less runtime の挙動 | 成果表示 |
| --- | --- | --- | --- |
| A: Direct CJS | 既存 `main.cjs` と pure JS 依存（preloadは別ゲート） | 組み込み engine の CJS loader がMainを評価 | Main source hashが一致。adaptedではpreload surrogate使用を別記、preload strict一致を主張しない |
| B: Prepared JS | 既存アプリに同梱済みのビルド成果物（TS製を含む） | 成果物 JS を同じ engineで評価 | 既存成果物 hash 一致。preload surrogateは差分に含め、元TSの実行互換とは称しない |
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
- **QuickJS 2026-06-04をMain用engineに選定済み**。[S6] N1aでC embedding、FFI寿命、ES/CJS semantics、配布サイズを実証する。重大な実装不能が判明した場合に限りADR改訂してJavaScriptCoreを再評価する。
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
| bridge（区別必須） | strict `contextBridge` は初版unsupported。adaptedは許可済みPromise IPC + page内local subscription | strictを互換と表示しない。adaptedはnative frame/document/grant E2Eが必須。任意preloadの同期proxyは提供しない |
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
- [x] Moji v1.0.5（commit `b7b1d585...`、MIT、M1〜M3）とjmd v0.2.3（`f875fc61...`、MIT、J1）を[ADR](../../docs/adr/0001-nodeless-macos-runtime-decisions.md)で選定。実機受入は未実行。
- [ ] main/preload の依存と動的 require / Node globals / Electron API を棚卸しし、fixture と symbol 単位の対応表を作る。
- [ ] A/B/C の入力モードと `tsconfig`、変換 toolchain、原本/成果物 hash の差を固定し、最低1件の限定 TS fixture を選ぶ。
- [ ] Electron oracle / source commit、MoonBit toolchain、engine、OS/SDK/WebView を固定する。既存 manifest の pin は出発点であり今回の実行証跡ではない。

**出口:** Node-lessの定義・実アプリ・engine・strict/adapted boundaryはADRで固定。残る使用symbol/値型inventoryとfixture/transformer/tool hashを完成し、unsupportedをレビュー可能にする。原本Mainを改修する必要が生じたら移植版と別表記する。

#### N1 — 最大リスクを先に潰す feasibility probes

- [ ] 組み込み engine で CJS fixture と Promise job / timer / error / listener identity を実行し、native event loop との接続を記録する。
- [ ] 同一機能の TS fixture を build-only 変換した結果と CJS 直接実行を比較し、unsupported な path alias/変換構文/Node external を明示的に拒否する。
- [ ] private transport の同期 window 操作で return/throw、nested callback、再入、UI thread deadlock、runner crash / timeout を検証する。
- [ ] adapted profileではWKWebViewのpageWorld document-start APIをnative `WKScriptMessageHandlerWithReply`経由のPromise-only allowlistへ接続し、strict同期proxyとは独立の負例試験を行う。[S2][S3]
- [ ] callback の登録/解除、Promise rejection、prototype 汚染、navigation/reload 後の古い handle、外部 frame の呼び出しを含む positive/negative test を用意する。
- [ ] QuickJS 2026-06-04 のvendor checksum、C ABI、プロセス構成、WebView adapterの安全性・配布サイズをN1aで実測し、ADRへの証拠追加を行う。初期engine選定自体は済んでいる。

**出口:** adaptedの非同期grant/送信元認証が実機負例までPASSすること。単純なasync応答だけでは不可。DOM event、page可読nonce、private WebKit APIは認証に使わない。strict同期`contextBridge`のgateは依然blocked。

**不成立時:** strict `electron-nodeless-v1` は当初からblockedを維持。adaptedもnative sender/grant testを満たさなければblocked。安全な別backendは新ADRで評価し、同期のElectron APIを黙って変更しない。

#### N2 — Node に依存しない縦断的な最小アプリ

- [ ] `core/` を使う native launcher / host と `platform/macos/` adapter を追加する。Node CLI を呼ぶ wrapper にはしない。
- [ ] MoonBit main から実 window/WebView を作り、local HTML 表示、resize、close/quit cancellation、終了まで接続する。
- [ ] native sender / frame / document generation を host が観測し、loadFile の root/symlink/origin/CSP/storage を検証する。
- [ ] 提案 `fixtures/nodeless/` に再現用の最小アプリを置く。Node/Electron のない製品試験環境で実行する。

**出口:** native-only アプリの起動・操作・終了が実機で成功し、Node 起動/リンクがなく、pending request と子プロセスが残らない。まだ既存 Electron アプリ互換とは表示しない。

#### N3 — 既存 CJS main/preload と Electron facade

- [ ] 提案 `bridges/embedded-js/` に engine leaf adapter / CJS loader を置き、lifecycle を JS 側へ重複実装しない。
- [ ] adapted profileではapp / BrowserWindow / native-audited async IPC facadeをMoonBit coreに接続する。preload surrogateの差分を明示し、strict `contextBridge`互換と表示しない。
- [ ] N0 で必要と判明した shim を明示的な allowlist で実装する。未対応 built-in / addon / import 経路は fail-closed にする。
- [ ] source/asset hash、module identity、同期戻り値、例外、必要なイベント順序を、同一 fixture の Electron oracle と差分比較する。
- [ ] TS build-only adapter を production packaging 前の段階に接続し、typecheck と transpile の証拠、変換 source map、unsupported diagnostics を分離する。

**出口:** A/B/C入力の原本・生成物hashとpreload差分が追跡でき、adaptedで許可された範囲だけが動作し、unsupported時には停止する。新規Node-less manifestに証拠を記録し、既存Node profileとは分離する。

#### N4 — 実アプリ受入・権限と寿命の堅牢化

- [ ] N0 の実アプリで open → 操作 → save → 再起動 → quit の代表操作を検証する。ファイル機能を持たない対象なら、そのアプリの実際の主要操作を N0 で固定する。
- [ ] dialog / clipboard / shell / 必要な file service、複数 window、listener removal、error/clone の対応範囲を埋める。
- [ ] renderer 偽装、iframe、remote navigation、symlink/root escape、巨大 payload、pending 上限、duplicate completion、host/runner/WebView crash を検証する。
- [ ] 日本語 IME、focus、コピー、DPI、アクセシビリティを実 WebView で確認する。unit test や Linux の結果で代用しない。

**出口:** Moji v1.0.5についてrevision・操作範囲・adapted preload差分を添えた `App Scenario Supported` 判定を提出できる。完全なElectron `App Compatible`とは表示しない。特権 API は公開allowlistとnative-attested senderで制限する。

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
3. **N1b-adapted: page-world async bridge + native sender grants** — adaptedをGoにする安全性のblocking gate。strict同期bridgeは初版blockedとし、別途ADRを要する。
4. **N2: native host/launcher vertical slice** — 実 window の作成・操作・終了。
5. **N3: source-preserving JS main + adapted preload/IPC** — 必要なshimと原本/生成物/adapter差分を試験。strict互換とは表示しない。
6. **N4/N5: real-app acceptance + distribution audit** — 実操作・Node 不在・署名・測定。

各子 Issue は依存 milestone、対象 symbol/設定/値型、変更場所、negative case、実行環境、PASS/FAIL/NOT RUN の出口条件を必須とする。N1 の結果前に大量の API stub を生成しない。

### 8. 完了条件と証跡の扱い

本設計タスクで**engineと実アプリの採用決定は完了**。runtimeへのQuickJS接続、native E2E、adapted IPCの安全性、互換性、軽量化の実証は**未実施**。MarkdownのPASSをruntimeの合格と混ぜない。

Roadmap の runtime 完了は N0〜N5 の出口条件、実アプリ1件以上の限定適合、Node 非依存 artifact と再現可能な証跡が揃った時点。N6 は継続的拡張であり、全 Electron/npm 互換を親 Issue の完了条件にしない。検証状態は `planned` / `partial` / `verified` / `unsupported` で管理し、blocked gate と NOT RUN を明示する。

### 9. 参照資料

仕様確認日: 2026-10-11。公式 `latest` 文書は設計の参考であり、実装の適合判定では固定バージョンの仕様/ソース/実行結果を使う。

- [S1: Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model) — main の Node.js 環境と renderer/preload の役割。
- [S2: Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge) — 同期・双方向 bridge、function proxy、copy/freeze の契約。
- [S3: Apple WKContentWorld](https://developer.apple.com/documentation/webkit/wkcontentworld) — world の分離と navigation 時の寿命。同期 function proxy の保証ではない。
- [S4: Electron ESM](https://www.electronjs.org/docs/latest/tutorial/esm) / [Sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox) — main / preload の異なる loader と限定 Node 環境。
- [S5: MoonBit FFI](https://docs.moonbitlang.com/en/latest/language/ffi.html) — native C ABI、foreign types、callbacks。
- [S6: QuickJS](https://bellard.org/quickjs/) — 2026-06-04版を初期engineに選定。Node / Electron API 互換を保証するものではない。
- [S7: esbuild TypeScript](https://esbuild.github.io/content-types/#typescript) — 型チェックなしの変換と `tsconfig` / TypeScript emit の制約。
