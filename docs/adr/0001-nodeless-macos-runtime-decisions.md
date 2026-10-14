# ADR-0001: Node-less macOS 実行基盤、ブリッジ境界、固定実アプリ

Status: accepted-for-design (Draft PR #3; 実装と安全性の実証は未完了)
Date: 2026-10-11
Decision owner: electron.mbt Node-less track
Scope: macOS arm64 / `electron-nodeless-*` のみ
Related: [Issue 0002](../../issues/open/0002-node-less-electron-compatible-moonbit-roadmap.md)、[Issue 0003](../../issues/open/0003-nodeless-existing-js-ts-runtime.md)、[PR #2](https://github.com/f4ah6o/electron.mbt/pull/2)

## 1. 決定の要約

| 論点 | 決定 | 確認と製品状態 |
| --- | --- | --- |
| Main JavaScript engine | **QuickJS 2026-06-04（MIT）を初期実装に採用する**。native C embedding、MoonBit が制御契約を所有 | 選定の確定であって FFI/互換/性能 PASS ではない。vendor tarball の SHA-256 とビルドフラグは N1a で固定 |
| macOS UI/renderer | AppKit + OS の WKWebView。Renderer のブラウザ JS と QuickJS Main は**別の realm/engine** | DOM、IME、アクセシビリティは WebView の実機試験が必要 |
| TypeScript | `electron-vite` 等の**ビルド時**変換を認める。Node は build/test/oracle 側のみ | 型チェックと transpile は別に記録。Node を製品へ入れない |
| 厳密な同期 `contextBridge` | **WKWebView 公開 API ベースの初版では No-Go / unsupported**。Electron と同じ同期 return/throw と任意関数 proxy を満たすと主張しない | `electron-nodeless-v1` の strict gate は **blocked**。現状不可能と数学的に証明した意味ではない |
| 安全な初期経路 | **`electron-nodeless-adapted-v1`** を別の「アプリ適応版」profile とし、監査した非同期 IPC API だけを document-start の page proxy として公開 | strict `contextBridge` と同一と呼ばない。preload を一般的に無改変評価したとも呼ばない |
| 実アプリ | **Moji v1.0.5**（TypeScript、初期主対象）と **jmd v0.2.3**（CommonJS、追跡対象）の commit を固定する | 上流コード・MIT license を確認。実行・互換試験は未実施 |
| 旧 Node 版 | `desktop-core-v1` / Issue 0001 / PR #2 は並走し、テストや verified 行を移植しない | 現行 `AGENTS.md` と `main` を本 ADR の追加だけで変更しない |

本決定は **方式・対象・許容差の確定**であり、「同期 bridge の安全性が実証された」とは意味しない。安全性の最終判定は native + adversarial E2E の結果に依存する。

## 2. QuickJS の採用理由と再検討条件

- QuickJS 2026-06-04 は小型の C 組み込み JS engine で ES2025 への高い準拠を公表している。Main は DOM を必要とせず、C ABI を MoonBit native host へ接続できる。Mac 固有の JSC に依存せず他 OS へ移しやすい。
- **JavaScriptCore** は macOS に既存の system framework がある点で魅力的だが、`JSContext` を作っただけで WKWebView の別プロセス内 `WKContentWorld` に関数参照を同期共有できるわけではない。macOS 限定 backend が追加され、初版の依存/検証軸が増える。
- **MoonBit 製 JS interpreter**、JS→MoonBit 全量ソース変換、Bun/Deno/libnode 同梱、Chromium/CEF 同梱を初版に採らない。
- 初期 native runner は QuickJS を別プロセスで起動し、同期で必要な短い Main API のみ private request/reply を持つ。MoonBit は lifecycle、document generation、authority、limits、診断、native acknowledgements を所有。JS には CJS module cache と function identity 等の realm 依存の最小 adapter だけを置く。
- 必須の N1a 検証は `JS_Eval`、`JS_ExecutePendingJob` 等の job queue、タイマー/exception/rejection、closure/callback GC root、native failure、CJS identity/cache/cycle、CPU/memory limits、macOS C FFI の unwind/thread affinity。実装関数名は QuickJS の pin した C ヘッダを確認して固定する。
- `QuickJS` が固定 fixture を正しく実行できない、または最低限の resource limits・保守/配布更新条件が満たせない場合にのみ engine 選定を ADR 改訂する。性能・バイナリサイズの数字は実測前に断定しない。

公式資料: [QuickJS (2026-06-04)](https://bellard.org/quickjs/)、[QuickJS manual](https://bellard.org/quickjs/quickjs.html)、[JavaScriptCore JSContext / JSVirtualMachine](https://developer.apple.com/documentation/javascriptcore/jsvirtualmachine)。

## 3. 同期 contextBridge は厳密互換と限定版を分ける

### strict profile: `electron-nodeless-v1` — blocked

Electron の `contextBridge` は隔離 realm 間で **同期** function call / throw、関数 identity、Promise、値 copy/freeze を要求する。一方、公開 WKWebView の `WKScriptMessageHandlerWithReply` は JS からの呼出結果が Promise になり、`evaluateJavaScript:inFrame:inContentWorld:` は native completion callback 型である。現行 [PR #2 の M0 診断](https://github.com/f4ah6o/electron.mbt/blob/feat/m1-native-host-contract/docs/0003-m0-contextbridge-feasibility.md) では shared DOM reply 偽装と元の page initiator 認証不能が実際に観測された。

**設計判断:** この公開 API / 既知の DOM 同期プロトコルを用いて「安全な汎用同期 bridge ができた」と主張しない。M0 strict gate を閉じず `compatible:false` / `blocked` とする。別 backend や同期 proxy の新機構を提案するなら、独立 ADR / 同一 Electron fixture の再現可能な native proof / security review を要求する。

やらない: shared DOM `CustomEvent` の返信を privileged decision に使用、page readable token を認証、UI/WebKit thread を待ち続ける同期 native RPC、preload を page world に移す、`contextIsolation:false`、同期 function を黙って Promise 化する。

### adapted profile: `electron-nodeless-adapted-v1` — planned / separate

WKWebView の **page world** に、アプリ単位の **監査済み allowlist manifest** から生成した API wrapper のみ `WKUserScript` / `atDocumentStart` で公開する。これは Electron `contextBridge` の実装ではない。

- 許可した RPC method は **Promise を返すものだけ**。page world で同期的に作れるローカル listener 登録/解除の disposer は別 category として実装可能。権限・ファイルI/Oを伴う同期値 API は unsupported で、失敗を隠さない。
- 公開する JS は**権限を持たない**。実行時にページ側が wrapper を置換したり `window.webkit.messageHandlers` へ直接 `postMessage` しても、native host は allowlist 以外を受け付けない。
- `WKScriptMessageHandlerWithReply` は *request/reply 用 async channel* として使用。受信時に native が `webView`、`WKFrameInfo.isMainFrame`、実際の URL/origin、現在の frame/document generation/session、operation/args 型/サイズ、リソース grant を検証。renderer が渡す `senderId`、origin、nonce、DOM 属性を認証に使用しない。信頼済み main が持つ API 権限から、公開 operation ごとに必要最低限だけ delegation する。
- `WKUserScript` は main frame の document-start のみ。cross-origin navigation / iframe / stale generation は拒否し、reload と close で listener / callback / pending を破棄する。イベントは host が所有している現行 document にのみ配達する。
- read/save は native file picker が承認したパスの grant / アプリ設定用領域だけを許可。renderer から任意のローカルファイルパスを指定できることをもって権限付与としない。外部 URL による file access / unrestricted shell invocation も拒否する。
- **original preload source は原本 hash を保持するが、初期 adapted profile の page API は manifest から生成した surrogate**。一般的な `exposeInMainWorld`、preload closure、同期 `webUtils.getPathForFile`、任意 `MessagePort` は実行再現しない。必ず `preload adapted`、`distribution transformed` と表示し、Electron `App Compatible` と表示しない。
- native が own document に対して許可済み channel を実行する場合でも、**ページが呼出主体である**ことを想定し、任意ページがアクセスしてもよい operation だけに制限する。イベント名、channel を隠すことは保護にならない。

この設計自体もセキュリティ PASS ではない。N1b-adapted E2E で host 発行 grant、frame/document/origin、入力型検査、冒頭 script からの API 存在、reload/cancel、DOM/event spoof、リスナーの寿命を実機で検証するまで通常 run / pack を解放しない。

公式資料: [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)、[WKContentWorld](https://developer.apple.com/documentation/webkit/wkcontentworld)、[WKScriptMessageHandlerWithReply](https://developer.apple.com/documentation/webkit/wkscriptmessagehandlerwithreply)、[WKUserScriptInjectionTime.atDocumentStart](https://developer.apple.com/documentation/webkit/wkuserscriptinjectiontime/atdocumentstart)。

## 4. 実アプリの固定と最小 acceptance

これらは **実在する MIT licensed Electron アプリ**。具体的 commit / 正本 / モード / 既知の非対応部分は [target registry](../../compatibility/nodeless-targets.json) に記載する。fixture 成功と実アプリ成功は分ける。

### Primary: Moji v1.0.5 — TypeScript/React + Electron

- 正本: [alexishida/Moji](https://github.com/alexishida/Moji/tree/b7b1d585d61772a0f791f165c8d07a420443b65b)、tag `v1.0.5`、commit `b7b1d585d61772a0f791f165c8d07a420443b65b`、MIT。
- `electron/main.ts`、`electron/preload.ts`、React renderer は **入力ソースを編集しない**。アップストリームの pinned `electron-vite build` をビルド専用で使用し、その成果物と npm lock の checksum、追加 manifest / 変換差分を保存。製品は Node/libnode を使用しない。
- **先行シナリオ:** (M1) 起動して Markdown サンプル表示・編集、(M2) native open dialog でテスト用 `.md` を開く、(M3) `saveAs` で一時領域に保存、閉じて再起動し内容一致を確認。OS ファイル grant と close guard を比較する。実ファイルは他のユーザーデータから隔離。
- 必要そうな依存: `app`、`BrowserWindow`、`dialog`、`ipcMain`、`Menu`、`shell`、`node:fs`/`fs/promises`、`node:path`/`url`、`screen`、`process`、`electron-updater`。**正確な symbol / バージョンは N0 でコードと build output から machine-readable に抽出して確定**。
- 初回除外: `webUtils.getPathForFile(File)` の**同期** drag-and-drop、アップデータ起動、画像/PDF/PNG export、未許可ファイルのパス読み、完全な menu/shortcut、非対応 Node module。非対応操作は Unsupported と分類。起動に必須な import が非対応なら、成功と偽装せず当該 adapter を明記し最小変更で再評価する。
- **理由:** v1.0.7 では `MessageChannel` を使った streaming 等が追加され、初期 bridge の受入範囲を増やす。最初のユーザー操作による file open/save と簡潔な `ipcRenderer.invoke` を v1.0.5 で先に検証する。

### Secondary: jmd v0.2.3 — plain JS/CommonJS

- 正本: [jojonki/jmd](https://github.com/jojonki/jmd/tree/f875fc616feb89ea803a0fc140ec770a2ade041e)、tag `v0.2.3`、commit `f875fc616feb89ea803a0fc140ec770a2ade041e`、MIT。
- `electron/main.js`、`electron/preload.js`、ビルド済み renderer asset（実験時の upstream Vite build）を別々に hash。CommonJS module identity / EventEmitter / IPC / menu を比較する。
- まず `main.js` による初期ウィンドウ/本文表示を **診断・起動試験**。`jmd-file:` custom protocol は `bypassCSP:true` の要求と任意ローカルファイル参照があるため、privileged scheme を黙って登録せず個別の設計・セキュリティ試験を通すまで **full-app acceptance 対象外**。Electron updater も初期対象外。
- jmd は JS/CJS 境界の強い試験材料だが、Moji の代わりに「リアルアプリ互換 PASS」を先取りしない。

## 5. 受け入れ判定（全項目は未実行）

1. **E1 — Engine / FFI:** Given pinned QuickJS C sources / macOS native toolchain, when 主 JS fixture の CJS/Promises/errors/jobs を走らせる、then Electron oracle の trace に対して明示した profile で比較でき、limits/GC/pending が bounded である。
2. **A1 — Strict security:** Given WKWebView 公開 API と既存 M0 negative fixture, when strict 同期 cross-world proxy を評価、then *本 ADR では未証明扱い*。`electron-nodeless-v1` の `compatible:false` を維持。別 ADR の実証までは解除しない。
3. **A2 — Adapted security:** Given app-level allowlist と実 WKWebView, when page が任意 handler/iframe/reload/DOM偽造/古い grant/危険 payload を使う、then native で対象外操作を拒否し、許可済み Promise 操作とローカル disposer だけを bounded に実行する。失敗した場合 adapted profile も blocked。
4. **M1〜M3 — Moji:** Given `b7b1d585` の unedited sources、when 固定 build tool でコンパイルして Moji のサンプル→開く→編集→保存→再読込→終了を実行、then scenario 固有の出力/ファイル内容/誤操作拒否が観察でき、変換・preload surrogate 等の差異が記録される。**Electron互換の全機能認定ではない**。
5. **J1 — jmd:** Given `f875fc61` の unedited CJS sources、when engine loader と window 初期化を行う、then CJS identity と unsupported custom protocol の診断が得られる。未実装 scheme の黙認では合格しない。
6. **N1 — Node-free audit:** Given 実際の署名済み macOS 配布成果物、when clean macOS arm64 で操作する、then `node`/`libnode`/`node_api`/Bun/Deno/hidden Electron/CEF がリンク・spawn・同梱・自動取得されない。build/tooling/oracle は別測定。
7. **P1 — Lightweight benchmark:** Given 同じ pinned app の release build、when Electron と比較する、then 圧縮・展開後 bytes、初回総DL、median/p95 cold/warm 起動、RSS/footprint の全関連 process、CPU・終了 cleanup を記録する。期待改善量は事前基準を付けても **実測なしで成功扱いしない**。

初期状況: **全項目 未実行。** 旧 Node runner の `npm test`、MoonBit unit、WK world probe が green でも上記の PASS にはならない。

## 6. 実装着手順序と保留事項

1. N0: 本 ADR と `compatibility/nodeless-targets.json` を review して採用。アップストリーム pinned app dependency/API inventory をコード・ビルド成果物に対して記録し、入力ソース/生成物 hash と fixture を固定。
2. N1a: QuickJS C + MoonBit FFI + CJS/async job test を最小実装。No-Go の条件を evidence で判断。
3. N1b-adapted: 許可済み Promise IPC / local subscription の page proxy と native sender/capability validation を組み合わせ、**攻撃的実機試験の Go/No-Go**。strict N1b は本製品の v0.1 blocking gate にしないが、strict compatibility は blocked に残す。
4. N2/N3: native launcher と MoonBit host を、独立した adapted profile の範囲で実装。設定・preload surrogate・scope 制限の差分を記録。
5. N4/N5: Moji の本物の主要操作で scenario acceptance、jmd の CJS 負例、Node-free 配布/比較測定。Go に至らなかった機能は未実装と明示する。

**変更管理:** この ADR の採用は PR #3 の Node-less 設計だけに作用する。`AGENTS.md`（実 Node.js を使う規約）・Issue 0001 / PR #2 は変更せず、Node-less 実装者が実際にコードを書き始める前に `AGENTS.md` の適用範囲と新しい profile の書き方を別差分で更新する。既存ブランチを reset/clean/stash/force-push しない。

**再検討条件:** QuickJS に対象 JS を忠実に実行できない致命的な欠陥がある、adapted IPC の privilege 漏洩、Moji の主要操作が不可避な厳密同期 bridge を必要とする、あるいは既存 API の無改変遵守がユーザーの製品必須条件となった場合は、この ADR を明示的に改訂する。製品保証やセキュリティ合格の宣言は試験前にしない。
