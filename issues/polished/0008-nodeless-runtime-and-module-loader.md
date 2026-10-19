# 0008: Node-less Main runtime・QuickJS FFI・module loader の実装設計

Status: polished
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: feat/issue-0008-quickjs-runtime

## 概要

**性質:** engine/loaderの調査を含む実装親Issue。**利用者への影響:** 固定した既存CJS/TS-build MainをNodeなしで実行し、起動できない依存や保存policy差を場所付きで診断できるようにする。

| 項目 | 内容 |
| --- | --- |
| 優先度 | P0（N1a engine gate）、P1（CJS / 必要 Node subset）、P2（直接 ESM） |
| 上位 | [0004 実用化ロードマップ](0004-production-readiness-roadmap.md) |
| 依存 | [0006 runtime / profiles](0006-runtime-architecture-and-profiles.md)、[0014 実アプリ inventory](0014-real-app-acceptance.md) |
| 関連 | [0007 bridge](0007-context-bridge-feasibility-and-security.md)、[0011 loading / storage](0011-app-loading-origin-and-storage.md)、[0012 OS services](0012-os-services-and-desktop-integration.md)、[0015 oracle / CI](0015-oracle-ci-and-evidence.md)、[0016 packaging](0016-packaging-release-and-updates.md) |

最初の限定作業はR1a / EP-08のQuickJS source pinとnative C ABI最小eval。R2のapp閉包やstrict bridgeが未確定でも、0006のprofile/ownership ADRを入力にしてengine probeを開始できる。

## 背景

### 1. 目的・現在地・既存作業との関係

1. QuickJS を MoonBit native から制御し、既存 CJS とビルド済み JS main を Node なしで実行する。TypeScript はビルド時に JS へ変換する。
2. `core/runtime.mbt` の lifecycle・ID・document generation・権限・bounded pending は再利用する。core の状態決定を JS に複製しない。
3. 現行 main の `bridges/node/cjs-loader.cjs`、`sync_channel.c`、`cmd/electron-mbt.cjs` は Node / Node-API に依存する。仕様・負例を参照できるが、Node-less launcher / module loader / FFI として流用しない。
4. [PR #3](https://github.com/f4ah6o/electron.mbt/pull/3) の HEAD `49ec04fac8f1db7212f98ade5a82128f1c4692e5` にある QuickJS 2026-06-04、macOS arm64、TS build-only、Moji / jmd の選定を引き継ぐ。PR #3 は設計文書であり engine の実装証拠ではない。
5. `desktop-core-v1` は実 Node を使う別 profile として保持する。`electron-nodeless-v1` の strict bridge は blocked、`electron-nodeless-adapted-v1` は独立した受入対象とする。
6. 本 Issue の設計調査時点で、QuickJS 組み込み、Node-less 実アプリ E2E、Node-free 配布物、サイズ・速度比較は未実行。通常 `run` / `pack` の gate はこの文書だけでは解除しない。

既存 Node 方針と Node-less の適用範囲は 0006 に従う。初回実装差分で AGENTS の profile 別責務を明示し、無断の Node fallback や既存 Node track の削除を避ける。

読取で確認した現行 [CJS loader](../../bridges/node/cjs-loader.cjs) はNodeの `registerHooks` / `createRequire`、[同期transport](../../bridges/node/sync_channel.c)はNode-APIを使用する。[loader tests](../../tests/loader.test.cjs)のfacade単一identity・ESM拒否・source不変、[transport tests](../../tests/transport.test.cjs)のnon-reentrant call・timeout後channel失効を、新engineへの移植時の契約入力とする。これらのNode実装をQuickJSへリンクしてNode-lessと表示しない。

## 問題

ECMAScript engineを組み込むだけではNodeのmodule解決、timers、I/O、Buffer、Electron lifecycleは提供されない。FFIの借用値をcallback後に保持するとGC/lifetimeが破綻し、Mainの同期待ちをUI threadへ移すと相互待ちが生じる。

さらにMojiはexport/updateの操作前からzlib/Buffer/updaterをimportする。除外した画面機能だけを見てshimを選ぶと最初のwindow以前に停止する。CJS解決・実boot閉包・明示adaptation・file brokerを別の検証可能な単位にする必要がある。

## 目標

### 2. 実装後に新しく動くこと

| 段階 | 利用者ができること | まだ主張しないこと |
| --- | --- | --- |
| R1 / N1aの部分実装 | native runnerでJS eval/例外/Promise/jobs/寿命を実証する | CJS loader受入、BrowserWindow / renderer / Electron互換 |
| R2 / N1aのCJS受入・N3 | cache/cycle/identityのfixtureを揃え、inventory内のCJS mainとpure JS依存を固定loader / Node subsetで起動する | 任意npm・ESM・Node-API |
| R3 / N4 | Moji の明示した adapted 操作を、Node を含まない main runner へ接続する | 元 preload の strict 同期互換、未検証の全アプリ互換 |
| R4 / 後続 | 必要性が確認された ESM、Node symbols を個別に追加する | ES2025 対応率から推定した Node 互換 |

R1〜R4は本書内の実装順。製品stage S1のABI/jobsだけでPR #3のN1aを完了とせず、S2のEP-11でCJS cache/cycle/identity等の必要fixtureが揃った時点で判定する。対応は [0020](0020-implementation-work-packages.md) に従う。

## 対象外

初版は任意npm、Node-API/native addon、Node/Bun/Denoの隠れたfallback、user-provided QuickJS bytecode、無制限network/stream、直接ESMの全面互換を含めない。TSはbuild時にJSへ変換し、rendererのDOMはOS WebViewへ委ねる。strict preload/renderer bridgeの成立は0007で別判定する。R4の必要ESM拡張は後続scopeとして保持する。

## 提案する方針

### 3. プロセス・言語・所有者

| 部分 | 主所有者 | 責務・境界 |
| --- | --- | --- |
| native launcher / UI host | MoonBit native + 薄い AppKit leaf | app session、OS UI thread、window / document / grant の正本、runner 監督 |
| QuickJS main runner | 別プロセスの MoonBit native | loader policy、ready 条件、job / timer の調停、request ledger、失敗分類 |
| engine adapter | C | QuickJS の値・例外・関数呼出・所有権の変換。アプリ権限の決定をしない |
| JS realm adapter | 最小限の JS | CJS `exports` / 関数 identity / listener object / Promise capability の realm 内操作 |
| host-service broker | MoonBit + OS leaf | 認可済み file/dialog/shell、結果と native ack、resource cleanup |
| WKWebView renderer | OS WebView | DOM / CSS / React / CodeMirror / IME / Web accessibility |
| gpui.mbt adapter | 公開 host 契約のみ | 必要な native window / service 接続。DOM の置換や React → GPUI 変換をしない |

runner と UI host は private な継承済み IPC handle を使用し、localhost の公開 port を初期経路にしない。renderer が raw transport を取得できる経路を設けない。

同じ core のコードを両プロセスへリンクしても、同じ window / grant 状態を双方で決定しない。UI host の正本と runner の確認済み mirror、API 呼出中の tentative state を区別する。

### 4. QuickJS pin・ビルド入力・更新

1. engine は **QuickJS 2026-06-04** を初期候補として確定済み。公式公開版と MIT license を再確認した。[Q1]
2. 新規 `vendor/quickjs/lock.json` に、source URL、tarball SHA-256、upstream commit が解決できる場合は commit、license hash、取り込む C/H 一覧、local patch hash を記録する。SHA-256 はまだ確定していない。架空値を置かない。
3. `CFLAGS`、compiler / SDK、target triple、CPU、LTO、feature flags、MoonBit compiler / runtime header の checksum を release evidence に含める。
4. `quickjs-libc` の `std` / `os` を無条件公開しない。module filesystem、process execution、network、worker を迂回して使える別入口を作らず、必要な C binding のみ登録する。
5. user-provided QuickJS bytecode を実行入力にしない。配布最初期は hash を固定した JS source を評価する。将来の事前 bytecode は engine version / build と結び付けた署名済み artifact に限定する。[Q2]
6. engine の minor 修正でも、FFI / loader / scheduler / real-app の差分 suite を同じ candidate SHA で再実行する。pin の更新だけで既存 `verified` を継承しない。
7. upstream source の取込不能、必須 fixture の誤動作、継続的な memory corruption、保守不能が確認された場合だけ ADR を更新して engine を再比較する。初期調査を毎回 engine 選定からやり直さない。

### 5. C ABI の最小面

以下は**新規提案 ABI**であり、既存の callable API ではない。生成される C header を pin した MoonBit runtime header と一緒にレビューする。

| 提案呼出 | 入力 / 出力 | 契約 |
| --- | --- | --- |
| `emb_engine_create` | limits / runtime handle | 初期化完了か typed error。部分確保は rollback |
| `emb_context_create` | runtime / context handle | main realm だけを作成。WebView の realm と共有しない |
| `emb_eval` | context、UTF-8 source、filename、mode | value lease または exception lease |
| `emb_call` | function lease、receiver lease、argument leases | 同期戻り値・同期 throw を保持 |
| `emb_value_dup` / `emb_value_release` | context-bound lease | 保持回数を明示。未知・破棄済み lease を拒否 |
| `emb_execute_one_job` | runtime | executed / idle / exception と、実行 context |
| `emb_promise_create` / `emb_promise_settle` | request ID、value / error | resolve / reject と callback root の解放 |
| `emb_collect` / `emb_measure` | runtime | cycle collection と診断用 heap / root count |
| `emb_interrupt` / `emb_engine_destroy` | reason / session | 追加 callback の拒否、全 lease の明示解放 |

1. MoonBit FFI へ `JSValue` の内部レイアウトを直接渡さない。C 内の `JSRuntime*` / `JSContext*` と保持済み `JSValue` を、型付き opaque handle / index + generation で包む。
2. `RuntimeHandle` / `ContextHandle` / `ValueLease` / `CallbackLease` を別型にする。context 不一致を call 前に検出する。
3. FFI の scalar は固定幅整数、pointer + length、明示した result tag に限定する。C enum / MoonBit payload enum / bool / `size_t` の配置を暗黙に等しいと扱わない。
4. UTF-8 長、NUL、lone surrogate、空文字、配列長、bytes overflow を明示変換する。`strlen` をアプリ値の長さ判定に使用しない。
5. C/ObjC exception や `longjmp` を MoonBit frame の外へ飛ばさない。QuickJS exception は検出後に取得して typed result へ変換する。
6. engine の public call は同一 runner thread に限定する。worker I/O 完了は immutable bytes / IDs を queue に載せ、JSValue を別 thread で操作しない。外部 thread / supervisor からの interrupt は atomic な取消 flag または IPC に留め、QuickJS API を並行呼出しない。
7. MoonBit の FFI ownership 既定値に依存せず `#borrow` / `#owned` を対象 compiler で明記する。外部 pointer が自動で参照カウントされるとは仮定しない。[M1]

### 6. 値・GC・callback の所有権

| 対象 | 取得時 | 保持期間 | 解放 |
| --- | --- | --- | --- |
| C callback の `JSValueConst` 引数 | 借用 | 当該 C callback 中のみ | 借用側で free しない |
| C が callback 後も保持する JS 値 | `JS_DupValue` により所有 | CJS cache / listener / pending が必要な間 | 明示解除で `JS_FreeValue` |
| Promise resolver / rejecter | capability 作成時に保持 | terminal 完了、cancel、session failure のいずれかまで | exactly-once settle 後に両方解放 |
| JS object に付随する native handle | class opaque data | owner object または session の寿命内 | finalizer は C 資源の解放のみ |
| C 側が保持する JS object 間の参照 | class 定義時に可視化 | object と同寿命 | `gc_mark` と teardown を対にする |
| MoonBit の入力 bytes | FFI call 内借用 | C が同期利用する範囲 | 非同期保持には owned copy |

QuickJS の reference count、exception sentinel、finalizer 制約を前提にこの ownership 表を実装する。C API の関数宣言は pin した `quickjs.h` と照合する。[Q2], [Q3]

1. callback ID は session ごとに単調増加または index + generation。解放済み ID が新関数を参照しない。
2. JS function の identity map と MoonBit の lifecycle map を分け、関数コードを native wire に送らない。
3. 解除中・callback 実行中は一時保持を作り、現在の call が終わるまで free しない。`once` の削除を callback 実行前に行い、再入で二重実行しない。
4. `Promise` resolve と native close の競合では、core が先に terminal を確定する。残った JS reply を捨てるだけで root を残さない。
5. app exit は orderly teardown を先に試み、deadline 後は supervisor が runner を終了させる。`JS_FreeRuntime` だけで OS handle や全 pending operation が清掃されたとは扱わない。
6. C sanitizer と root count の両方を使い、正例だけでなく forced GC、cycle、throw、close、timeout の各出口を検証する。

### 7. Promise・microtask・timer・I/O

#### 7.1 scheduler の正本

MoonBit が以下を持つ。

- monotonic clock と timer min-heap。
- UI host / worker completion の bounded ready queue。
- native request の session / request ID と terminal 状態。
- main の評価完了、ready の通知可否、停止中かどうか。
- runner に残る ref'ed work と、watchdog / shutdown deadline。

QuickJS は JS Promise job queue を持つ。MoonBit は `JS_IsJobPending` / `JS_ExecutePendingJob` を C adapter 経由で駆動し、Promise の内部状態を MoonBit で複製しない。[Q3]

#### 7.2 1 turn の設計

1. main entry または 1 つの callback を実行する。
2. 対象 profile が `process.nextTick` を公開するときだけ、独立した nextTick queue を checkpoint 規則に従い処理する。
3. Promise / `queueMicrotask` の checkpoint を完了させる。checkpoint 中に追加された job の順序も fixture で固定する。
4. shutdown / host loss / pending terminal を確認する。
5. 次の ready I/O、期限に達した timer、UI event を選ぶ。宿主側に pending がなければ次の deadline まで待つ。

JS budget 超過時に、途中の microtask queue の間へ通常 timer を挿入して互換に見せない。外部 kill / interrupt を処理して session を bounded に終了させるか、互換範囲を外れたことを明示する。

CJS と ESM では Node の nextTick / microtask の先後関係が異なる。CJS 用 checkpoint をそのまま ESM に移さず、R4 で ESM oracle trace を別に持つ。[N1]

#### 7.3 timer / event / error

| 機能 | 初版方針 | 必須試験 |
| --- | --- | --- |
| `setTimeout` / `clearTimeout` | native monotonic timer + JS callback lease | cancel、callback 内再登録、throw、終了時 root 解放 |
| Timeout object | `ref` / `unref` / `hasRef` を実装対象 | jmd の `.unref()` が process を不必要に保持しない |
| `setInterval` | inventory が要求した時点で追加 | 遅延・長時間 callback・cancel の意味を oracle と比較 |
| `setImmediate` | 初版は未対応、需要が出たら追加 | I/O callback との先後関係を独立比較 |
| `process.nextTick` | transitive dependency が必要とするなら R2 の必須 gate | nested ticks / microtasks / exception / starvation |
| EventEmitter | JS identity と同期 listener 呼出を保持 | `this`、登録順、`once`、off、同一 listener 重複、emit 中の追加削除 |
| uncaught exception | request-local に変換可能なものと process-fatal を分離 | boot failure、timer throw、callback throw、core への terminal 通知 |
| unhandled rejection | host rejection tracker を実装 | 同 turn で handler が付くケース、後で handler が付くケース、終了方針 |

timer の厳密な発火時刻や、仕様が順序を保証しない独立 I/O の total order を oracle と同じにする要求は置かない。比較は仕様で保証される partial order と値・終端結果に限定する。[N2], [N3]

#### 7.4 初期 resource budget（提案値）

| 対象 | 初期値 | 超過時 |
| --- | --- | --- |
| QuickJS heap | 128 MiB / runner | typed OOM、session failure、host に終了通知 |
| JS stack | 1 MiB / runner | controlled exception / fatal 判定 |
| 1 entry / callback の watchdog | 5 秒 | interrupt + supervisor deadline。通常 IPC handler の意味上の timeout と混同しない |
| outstanding JS callback leases | 4,096 / session | 新規登録を拒否、既存 callback は維持 |
| pending timer | 1,024 / session | explicit limit error |
| module file / module count | 8 MiB / file、4,096 files | preflight または loader failure |
| shutdown grace | 5 秒 | runner kill + ledger に実終了理由を保存 |

これらは実測済み性能保証ではない。0014 の workload で値を変更する場合、manifest version と evidence を更新する。既存 core / transport の上限が小さい場合はそちらを優先し、黙って拡大しない。

### 8. 同期 native API と deadlock 回避

1. `BrowserWindow` constructor / 同期 getter は短い private request/reply を使用する。UI host の response を main runner が待つ間、通常の JS event loop を再入させない。
2. UI host はこの request 中に main の JS callback を待たない。OS query / create の完了または typed error を返し、イベント通知は別 queue に積む。
3. constructor の返却前に native 作成失敗を取り消す。作成予定 ID を実ウィンドウとして public getter へ返さない。
4. close / before-quit の cancelable callback は、native が先に破壊してから後付け通知する方式にしない。UI host が pending decision を保持し、runner の同期 listener 判定後に進める。
5. この decision 中の getter が再び native host を呼ぶ負例を含める。循環待ちになる API は対応済みへ移さない。
6. timeout 後の channel reuse、late reply、host restart、request ID 再利用を禁止する。session identity を handshake に結び付ける。

Node の同期 socketpair probe の PASS は、この QuickJS ↔ native host 経路の実測を代替しない。

### 9. CJS loader：最初に確定する有限仕様

#### 9.1 module record

新規 MoonBit `ModuleRecord` は `moduleKey / sourceHash / kind / loadingState / parentEdges / diagnostic` を持つ。JS realm 内の record は `module.exports / exports alias / loaded / filename / id` と保持用 lease を持つ。state の所有区分を重複させない。

1. specifier を builtin / relative / absolute / package に分類する。
2. profile の module policy で解決し、許可 source inventory 内で filename と package boundary を決める。
3. module cache に loading record を先に作成し、CJS wrapper を実行する。
4. 循環 require はその時点の `module.exports` を返す。
5. 評価成功後に loaded を確定する。評価失敗時の cache cleanup と再 require は pinned Node oracle と比較する。
6. source hash / filename / sourcemap を error に付け、wrapper の余分な行をアプリ位置へ補正する。

#### 9.2 resolution matrix

| 入力 | R2 | 判定 |
| --- | --- | --- |
| `require('electron')` | 対応対象 | session 内で単一 facade identity、偽パッケージへ fallback しない |
| allowlisted `node:fs` / `fs` 等 | 対応対象 | builtin policy を先に判定、未対応 builtin は user package へ解決しない |
| 相対 `.cjs` / `.js` / `.json` | 対応対象 | `.js` は package type と profile 条件を確認 |
| extensionless / directory main / index | 対応対象 | Node の候補順と失敗結果を golden fixture で固定 |
| nested `node_modules` / scoped package | inventory 内のみ | 同名でも異なる package instance の identity を潰さない |
| package `exports` / `imports` / self reference | 使用例から段階追加 | 未実装条件を無視して `main` へ降格しない |
| computed require | runtime 側も検査 | static scan が列挙できなければ unknown。診断 green にしない |
| `.node` / QuickJS native `.so` | unsupported | application-controlled native module をロードしない |
| network import / global package / `NODE_PATH` | 初期 unsupported | ambient environment で解決結果を変えない |
| ESM main / `.mjs` | R4 まで unsupported | CJS に見せかけて直接評価しない |

Node の cache は resolved filename に依存し、CJS cycle は途中の exports を観測し得る。別 package の singleton を basename だけで統合しない。[N4]

アクセス許可の canonicalization と JS に見せる module identity を混同しない。symlink / case alias の未対応組合せは事前拒否し、inode や lowercase 名へ勝手に統合しない。code source 読み出しの TOCTOU・root escape は 0011 の資源読み出し契約を使用する。

`require.cache` の全面書換え、`require.extensions`、`Module._load` monkey patch、`module.createRequire` は初版保証に含めない。アプリが実際に利用するなら named gap として追加する。

### 10. Node subset：Moji の実物から優先する

[0014](0014-real-app-acceptance.md) の fixed source inventory は、Moji の起動閉包に `node:zlib` と `electron-updater` が含まれることを確認した。画面で export / update を押さないだけでは import が不要になるとは言えない。

| surface | 先行 symbols / behavior | owner / 次段階 |
| --- | --- | --- |
| `path` | `join / dirname / extname / isAbsolute`、jmd の `resolve` | pure MoonBit operation + JS facade。macOS POSIX と `win32` は別 matrix |
| `url` | `fileURLToPath`、jmd の `pathToFileURL` / `URL` | spaces / `%` / non-ASCII / invalid file host。path と URL を文字置換で相互変換しない |
| `fs` | `existsSync / readFileSync / writeFileSync` | settings 用同期 API。runner を block し得るが UI thread で I/O しない |
| `fs/promises` | `readFile / writeFile` | host broker + JS Promise。encoding 省略時の byte container と文字列時を分離 |
| Buffer | `from` / `alloc` / `concat` / `subarray` / `toString` 等を使用 symbol ごとに | `Uint8Array` であることだけで Buffer 互換を宣言しない |
| events | `EventEmitter` / `on / once / off / emit` | listener identity、同期 dispatch と error event を比較 |
| process | `platform / arch / argv / env / resourcesPath`、必要な version / exit fields | runtime の実体を記録。存在しない Node / Chrome の version を捏造しない |
| `zlib` | Moji `createDeflate` は boot import に存在 | 元 module を保持するなら import と必要な stream surface が別 gate |
| `fs.watch` | jmd の persistent false、error、close、再 arm | J1 negative の後続。file watching 全 API は初版保証外 |
| `electron-updater` | lock した package の import 閉包 | 起動 adaptation の ADR または本当の依存実装が必要 |
| `child_process / worker_threads / vm / net / tls` | 初期未対応 | 要求時に場所と依存 chain を示して fail-closed |

Node `fs` / Buffer / URL の挙動は API 名だけでなく、encoding、exception fields、return type を単位に検証する。[N5], [N6], [N7]

#### 10.1 権限との接続

1. main JS は固定した信頼済みアプリ principal とする。renderer が main source を差し替えることや任意関数を実行する経路を提供しない。
2. renderer 起点操作は native ingress で window / document / operation / path grant を検証した後で main handler に渡す。generic `readPath` を無検証転送しない。
3. main の fs shim は private transport で UI host の file broker へ要求する。broker は source read-only、app settings、明示的 file grant の範囲を再検証する。path spelling の一致だけで所有権を認めない。
4. 元 `fs.readFile(path)` signature には document ID がない。global `currentSender` を async callback 間で共有して権限を決めない。
5. main の信頼・app 単位 grant と、renderer の document 単位権限を区別する。request 単位の実行権限を Promise / timer 後まで強く継承する場合は、context 伝播の実装と interleaving 負例を別 gate とする。
6. reload 後に旧結果を新 page へ配達しない。認可済み I/O の取消・commit point・完了の扱いは 0011 で固定する。取消要求だけで write が rollback したとは扱わず、commit 前の failure と commit 後の committed / unknown を区別し、自動 retry しない。

#### 10.2 Node の書込契約と明示した保存 adaptation

1. fs shim が受け付ける path / data / options の形、encoding、flags、同期 return / throw と Promise resolve / reject、error fields を symbol manifest へ固定する。対応していない descriptor、append、stream、options を通常の文字列置換へ読み替えない。[N5]
2. 汎用 subset の `node-write-file` は、対応する Node の truncate / write、inode / hardlink、creation mode、途中失敗の観測を oracle と比較する。temporary file + rename へ黙って置換せず、失敗時に元 bytes が必ず残るとは宣言しない。
3. Moji の初期 M3 では [0011 §5.1](0011-app-loading-origin-and-storage.md#51-moji初期adaptedの保存方式) の `atomic-replace-v1` を明示した behavior adaptation とする。適用する grant / path、許可する writeFile signature、metadata policy を app/profile manifest に持ち、Main fs facade から broker への要求にも mode を固定する。原本 Main の hash が同じでも Node の意味論が無変更であるとは表示しない。
4. 書込権限と書込方式は別に検証する。open-for-edit / saveAs の native 選択と grant 更新、再起動後の再許可を 0011 に従わせる。read-only grant を atomic mode の指定で昇格させず、renderer が申告した file identity で再 save の権限を更新しない。
5. atomic mode は初期受入の単一 link regular file、許可した metadata と競合保護範囲に限定する。非対応 metadata / hardlink / flags は実書込前に拒否する。普通の rename を expected inode 付き CAS と称さず、commit record、metadata、check 後の差替、flush / reply 喪失を別に観測する。
6. settings の `writeFileSync` と文書の `fs/promises.writeFile` に同じ mode が適用されると推測しない。選択した signature / 対象ごとの mode を記録し、両者の error、readback、復旧結果をそれぞれ評価する。fake broker での facade 成功は、0011 の実 file / grant 受入の代用にしない。

### 11. TypeScript / Prepared JS / ESM の実装順

| mode | 最初の入口 | provenance |
| --- | --- | --- |
| A: Direct CJS | 既存 `.cjs` / 明示 CJS `.js` | 入力 source と実行 bytes の一致 |
| B: Prepared JS | 上流が配布した main JS | 提供済み JS の一致。元 TS の評価成功とは表示しない |
| C: TS build | upstream pinned build command | TS source / lock / build config / 生成 JS / renderer / adapter を別 hash |

1. Moji は上流 `electron-vite build`、`tsc --noEmit -p tsconfig.json` を**別工程**として評価する。package range を採用 version とせず lockfile を読む。
2. `out/main/main.js` が実際に CJS か ESM か、external builtins、dynamic imports、transitive dependencies を生成後に再調査する。
3. `tsconfig.paths / JSX / decorators / import.meta / top-level await / .cts / .mts` は fixture ごとに supported / unsupported を明示する。
4. build adapter が alias / tree shaking / module replacement を行ったら、変更された dependency semantics と hash を記録する。main dependency を置換したものを preload-only adaptation と呼ばない。
5. transpile 成功は型チェック成功ではない。esbuild の単独ファイル変換に伴う制約を source-preserving build の事前条件に含める。[T1]
6. R4 の直接 ESM は QuickJS module loader の pin、URL-based identity、package conditions、dynamic import、TLA、CJS namespace interop を個別実装する。
7. R4 でも preload は別 loader。Electron では sandboxed preload の ESM に制約があるため、main で ESM が動いた結果を preload へ転記しない。[E1]

### 12. 診断・実装ファイル・分割 PR

| 分割 | 新規実装予定 | 完了時の証拠 |
| --- | --- | --- |
| R1a vendor / ABI | `vendor/quickjs/lock.json`、`bridges/embedded-js/quickjs_adapter.c`、header、MoonBit FFI wrapper | source/build pin、ownership review、minimal eval、exception |
| R1b jobs / lifetime | `runtime/embedded/` scheduler / handle registry、`fixtures/nodeless/engine/` | Promise / GC / timer / host-loss traces、sanitizer |
| R2a loader | `runtime/modules/`、`bridges/embedded-js/cjs-bootstrap.js` | cache/cycle/resolution differential、source hashes |
| R2b subset | `runtime/node_subset/`、`fixtures/nodeless/node-subset/` | Moji direct/transitive symbols の有限 manifest |
| R3 native integration | native CLI entry、private transport、既存 core adapter | Node-free launch / close / cleanup、Moji gate の接続 |
| R4 ESM | embedded module loader、ESM fixtures、manifest rows | 必要性の根拠、直接 ESM の独立 oracle |

上記のパス・コマンドは予定であり、存在済みとして README に案内しない。実装 PR で実際の test / CLI command を確定する。

診断は `code / phase / profile / module / parent-chain / symbol / source-position / runtime-sha / evidence-id` を含める。filesystem absolute path、env、ユーザー文書本文の不要な出力を避ける。

`unsupported`、`policy_denied`、`engine_exception`、`module_not_found`、`host_lost`、`limit_exceeded`、`not_run` は別 code にする。`unsupported` を空 object / false / success に変換しない。

#### 最初の限定PRと着手条件

1. 0006 / EP-06のnative owner・profile ADRを確認し、QuickJS 2026-06-04の取得元、実tarball SHA、license/build flagsを `vendor/quickjs/lock.json` に記録する。未確定checksumの採取はこの作業の入力固定であり、engineの再選定ではない。
2. `bridges/embedded-js/`へcreate/context/eval/value-release/destroyだけのC ABIとnative MoonBit wrapperを追加し、QJS-01/02/05の必要部分を実行する。Node addonを経由しない。
3. partial-create、throw、forced GC、stale/cross-context handleの結果・root balanceを保存し、ABI ownership reviewを受ける。jobs/timersはR1b、module cacheはR2aの別PRへ進める。
4. 後続で公開するABI/`.mbti`、source/build/profile manifestと互換を変える差分は同じPRでversion・移行対象を記録する。

## 受け入れ条件

### 13. What 受入テスト

| ID | Given / When | Then |
| --- | --- | --- |
| QJS-01 | pinned native engine で primitive / object / throw を評価 | 同期値・同期例外を観測でき、source location が保存される |
| QJS-02 | callback を保持して GC、解除後に GC | 保持中は呼べる、解除後は stale error、root count が戻る |
| QJS-03 | Promise resolve / reject と close / host loss が競合 | terminal は 1 回、両 resolver の root が解放される |
| QJS-04 | 無限 loop / microtask chain / allocation storm | configured limits で停止し、UI host が生存または整合して終了する |
| QJS-05 | C callback 中に throw / OOM / invalid UTF-8・長さが発生 | ABI 外へ unwind せず typed error、リーク・double-free なし |
| MOD-01 | CJS cycle / exports reassignment / duplicate require | pinned oracle の値・identity、評価回数と一致 |
| MOD-02 | nested 同名 package / JSON / directory entry | parent ごとに正しい instance、cache と source hash が対応 |
| MOD-03 | unsupported exports condition / `.node` / code root escape | evaluation 前または到達時の明示 failure、別 module へ fallback なし |
| MOD-04 | dynamic require が静的 inventory を越える | unknown gap を捕捉。preflight の成功で互換判定しない |
| LOOP-01 | nextTick / Promise / timer / I/O を interleave | profile の保証された partial order と同じ |
| LOOP-02 | `unref()` timer だけが残り main / windows が終了 | timer のために process が残存しない |
| SYNC-01 | constructor / getter / close handler 再入 / host crash | 同期 semantics、bounded termination、late reply の不採用 |
| FS-01 | 2 document から異なる許可 path を同時要求 | native ingress の相互 grant 漏れなし、旧 page に結果を再配達しない |
| FS-02 | `node-write-file` の対応 signature で同期 / Promise 書込と故障を比較 | bytes / return / error / metadata と部分失敗が pinned oracle に一致。atomic mode の保証を流用しない |
| FS-03 | 明示 atomic mode で通常 save / 再 save / 再起動再許可、commit 前後の故障 | grant / identity の更新は broker が所有し、read-only 昇格なし。committed / unknown / failed と元 bytes 保持の条件を区別 |
| BUILD-01 | Moji TS と locked build | input hashes 保存、typecheck / emit / execution を独立判定 |
| FREE-01 | Node-free packaged runner で実行 | node/libnode/Node-API/Bun/Deno/Electron/CEF の spawn/link/bundle/fetch 不在 |
| ESM-01 | R4 で main ESM / TLA / CJS interop を実行 | 専用 trace と gap、CJS 成功を流用しない |

実装後、Linux は portable / engine 契約に使用し、macOS arm64 は native runtime / WebView / real-app の判定に使用する。既存 `npm test` の PASS は Node-less 受入へ移さない。

### 14. 完了条件・未実行事項

1. R1〜R3 の必要 surface と失敗条件が実装され、0014 の選定済みシナリオへ接続できる。
2. 全 ABI ownership exit と process cleanup の証跡が candidate SHA に結び付く。
3. unsupported module を到達時に診断し、Node fallback を使わない。
4. Node-free artifact audit と実測がない限り shipping 完了にしない。
5. strict bridge の blocked は本 Issue の engine 成功だけでは解除しない。
6. R4、full Node、native addon、任意 network / stream は要求済み scope を個別 Issue へ残す。

**設計時検証状態:** source / upstream API の読取を実施。QuickJS build、FFI tests、Node-less runner、Moji build / E2E、macOS native test、release audit は **未実行**。

- [ ] Given vendor pinとnative toolchainが固定されている, when 最小ABIでeval/throw/retain/releaseを実行する, then QJS-01/02/05の実結果とC ABI reviewが同じSHAに結び付く。
- [ ] Given R2のselected emitted module graph, when CJS/Node subsetでbootする, then MOD-01〜04とeager import失敗を観測し、未実装を空moduleで隠さない。
- [ ] Given explicit atomic-save adaptation, when FS-02/03を比較する, then Node書込と強い保存policyの違い、grant更新、committed/unknownが別reportになる。

## テスト計画

| 段階 | entry / fixture | 成功としないもの |
| --- | --- | --- |
| 現行MoonBit回帰 | `moon test --target js`、`moon test --target native` | core成功だけでC ABIを認定しない |
| 現行Node境界 | `npm run build` 後 `node --test tests/loader.test.cjs tests/transport.test.cjs tests/manifest.test.cjs` | Node-API socketpair/Node loaderをNode-less実行へ転記しない |
| R1a/R1b新規 | `fixtures/nodeless/engine/`にQJS/LOOPのgolden・故障fixture。native build/test entryは実装PRでREADME/CIへ追加 | compile-only、GCを伴わないpositiveだけは不足。現時点NOT_RUN |
| R2新規 | `fixtures/nodeless/node-subset/`とmodule fixture、fixed Node oracle | CJSとESM、signature別fs、same package instanceを別判定 |
| R3実機 | SYNC/FSと0014のMoji scenario、actual WKWebView/QuickJS | Linux portableまたはfake brokerだけでは未受入 |
| release | FREE-01、0016のlink/bundle/process/clean-OS監査 | PATH上でnodeが見えないことだけでは不十分 |

toolchain・source・実行command・exit・必要observationを0015のevidenceへ記録する。sanitizerは対象compilerが提供するbuildで実行し、その構成と未実行範囲を示す。既存commandは上記の回帰用、新規commandは実装前に存在すると案内しない。

## リスク

| リスク | 観測・対処 |
| --- | --- |
| FFI borrow/owned、GC mark、thread affinityの誤り | QJS-02/03/05、sanitizer、root台帳。memory corruptionを残して次stageへ進まない |
| jobs/nextTick/例外の順序をNodeと取り違える | CJS/将来ESMを分けたpartial-order oracle。長いjobでUIが停止しないことを測る |
| updater/zlibの実閉包が初期subsetを越える | EP-05でemitted graphとtraceを取得し、実装範囲または明示adapterを再見積り |
| atomic saveをNode fsの同等実装と表示する | 10.2・FS-02/03でmode/metadata/commitを分離し、source hashだけで無変更を主張しない |
| engine pin更新でABI/bytecode/挙動が変わる | source/header/build hashと全必要fixtureを再検証。以前のverifiedを自動継承しない |

## 未解決の質問

| 判断が必要な点 | 判断owner / 必要な証拠 | 再開条件・依存scope |
| --- | --- | --- |
| Mojiのemitted boot閉包に対しupdater/zlibを本当に実装するか、依存adapterを採るか | app/loader担当＋profile owner。0014/EP-05の実build・import chain・first-use traceとbehavior差分 | ADRとrequired symbols/adapter hashが揃った閉包だけR2b/R3へ接続。R1a/R1bのprobeは着手可能 |
| uncaught exception / unhandled rejectionのどの観測を初期profileで約束するか | engine担当＋oracle担当。boot・timer・IPC・late rejection handlerを固定Node/app版で比較 | process-fatalとrequest-localの境界、tracker checkpoint、公開するprocess surfaceをfixture化してR1bを受入。未定義のpolicyを成功として公開しない |

## 変更履歴

- 2026-10-17: ユーザー指示により `issues/open` から `issues/polished` へ移動し、`Status: polished` と現行参照を同期。実装の準備状態・未解決事項・受入証拠は変更していない。

- 2026-10-19: Node-less main fs 増分。`--window` の private host bridge 経由で `fs.existsSync` / `readFileSync` / `writeFileSync` / `fs.promises.readFile` / `writeFile` を実装。canonical app root の read、`.appData`/`.userData` の atomic write、256 KiB 上限、`realpath` による traversal/symlink-escape 拒否、write root 内の missing parent 作成を追加。`fixtures/nodeless-fs-app --fs-selftest` で UTF-8/Buffer/base64、sync/async、200,000-byte round-trip、nested write、empty file、EACCES/ENOENT/EFBIG、symlink escape を検証。Moji は `setSettings({language:"ja"})` の永続化を harness が独立確認。non-window run は `ELECTRON_MBT_HOST_UNAVAILABLE`。main user-file grants、directory/stream API、callback readFile、thread-pool async、metadata/TOCTOU は未実装。`compatible:false`、受入行なし。docs/0046。
- 2026-10-19: Node-less broker E2E 増分。`native/nodeless --broker-selftest` が manifest-listed `nodeless-broker.json` を native `grant-file` / `set-dialog-result` に適用し、real Moji renderer の `window.api` 経由で open/save/readSample/saveAs/HTML/PDF/PNG document/diagram PNG export を実行する。1 grant、6 dialogs、`apiProbe.state:"done"`、6 出力 file の内容/マジックを確認。`checkForUpdate` は unsupported。`--broker-selftest` なしでは broker file を無視する負例あり。production consent、human open/save panel、grant persistence、print-accurate export、updater/zlib、original preload は未実施。`compatible:false`、受入行なし。docs/0045。
- 2026-10-19: adapted renderer 増分。`native/nodeless --window` が snapshot-scoped `electron-mbt-app://` scheme で real Moji renderer を読み、manifest-listed generated page adapter を document-start に注入し、page の `app-request` を MoonBit event pump 経由で QuickJS `ipcMain` handler に dispatch して `app-reply` を返す。`fixtures/nodeless-adapted-app` は ES module、custom-scheme origin、entry-directory 外 asset の拒否、2 件の page API call を検証。pinned Moji は 113 files、`pageURL:electron-mbt-app://app/out/renderer/index.html`、`pageTitle:"Moji v1.0.5"`、`rootChildren:1`、`apiPresent:true`、`preloadExecuted:false`、`liveLeases:0`、`nodeProcesses:0`。binary renderer asset は text source と分離して admit。original preload は NOT_EXECUTED、strict blocked、real fs/dialog/export/update/zlib、human scenario、ASAN/ownership/external review は未実施。`compatible:false`、受入行なし。docs/0044。
- 2026-10-19: G-2/G-3 部分増分。`native/nodeless --window` が real native host と AppKit/WKWebView window を起動し、C host bridge 経由で bounded `BrowserWindow`/`loadFile`/title/webContents を提供。`fixtures/nodeless-window-app` は `nodeless-window-ready` で PASS。pinned Moji main (`41cd...`) は probe page に対して harness なしで boot し、`preloadExecuted:false`、`rendererLoaded:false`、`compatible:false`。`fs`/`fs.promises` は import-only (ENOENT/EACCES)、`zlib` は import-only、`electron-updater` は explicit import-only stub で、Node/Electron の意味論ではない。real fs broker/atomic save、zlib stream、updater 挙動、real renderer/asset loading、preload/contextBridge、app scenario は未実装。docs/0043。
- 2026-10-19: Node-less main runtime の第1増分を実装。`native/nodeless` が pinned source manifest を native SHA-256 で検証し、MoonBit の CJS graph / package exports / nested node_modules を構築して、QuickJS + bounded Node/Electron prelude で `fixtures/nodeless-app` を Node なしで実行する。CJS cycle/cache、JSON、`path`/`url`/`process`/`events`/`Buffer`、`app`/`ipcMain`、nextTick→jobs→timers、async handler、`node:fs` の typed fail-closed を確認。`node`/`napi` の link/spawn なしの audit と negative tests を追加。ただし native window/host、`fs`/zlib/updater、preload/renderer、Moji、strict profile は未実装で、ASAN/ownership/external review は NOT RUN。受入行は増やさず `compatible:false`、strict blocked のまま。docs/0042。
- 2026-10-17: QuickJS pin/FFI ownership、scheduler、CJS/subset、TS build、fs semantics、QJS/MOD/LOOP/SYNC/FS/BUILD/FREE/ESMの受入IDを設計。
- 2026-10-17: `polish-issue`で関連Node実装・テストと照合し、R1aの限定PR、具体的な回帰entry、判断ownerとscope別準備状態を追加。必須metadata/構成へ再配置し、API/limits/固定SHA/出典/受入IDは保持。runtime codeや既存PRは変更していない。

## 注記

- 2026-10-17: ユーザー指示「mv to issues/polished」に従い、整備済みの計画を open から polished へ移動。未解決事項・依存条件・runtime の未受入は本文に保持する。

- **将来の非blocking候補:** request-bound authorityをPromise/timer後まで引き継ぐ拡張は、初期実装の必須判断ではない。初期は10.1のtrusted Main/app grantモデルを採用する。security/app担当が複数documentのinterleavingと元appの呼出traceから追加の必要性を確認した場合だけ、明示context設計と独立gateを追加する。global currentSenderで代用しない。

**状態と配置:** 2026-10-17 のユーザー指示により `open` から `polished` へ移動した。現在の保存先は `issues/polished/0008-nodeless-runtime-and-module-loader.md`。`polished` は計画の整備状態であり、runtime の受入や未解決事項の解消を示さない。着手は本文の準備状態・依存条件に従い、受入は [AGENTS.md](../../AGENTS.md) と各試験の実証で判断する。進捗と再開条件は本ファイルへ記録する。

- **準備状態:** EP-06の共有ADRを入力にR1aのpin採取・ABI probeへ着手可能。Moji向けR2b/R3は実boot閉包/adapter判断を要し、strict bridgeは別gateのまま。engine未実装という理由で調査全体を停止しない。
- **再開・記録先:** 未解決事項と後続依存は本文の証拠・担当role・再開条件で判断し、進捗は本ファイルへ記録する。状態を変更するときはmetadataと配置を同時に更新する。
- **ブランチ:** `Branch` の `feat/issue-0008-quickjs-runtime` は実装時の提案名であり、この整備で作成したbranchではない。既存PRの履歴を消さず、小さい統合PRへ分ける。
- **確認基点:** 本整備のmainは `8177cf051976b8d7b9eca25ae7ad8820bb04a719`。初回設計の `30c6fc97186e7ecfc8397c799525f00c8e4f0f65` と各PR/appの固定SHAは履歴根拠として保持する。mainへのPR統合・runtime実装・native E2E完了を意味しない。
- **検証の範囲:** 2026-10-17のpolishはIssueと関連source/testの読取・文書整合を対象とする。下記のruntime/GUI/配布試験は、この本文更新では実行していない。実行する際はcommand、対象SHA、環境とPASS / FAIL / NOT_RUNを別記録にする。

### 15. 一次資料

- [Q1: QuickJS 公式公開版・license](https://bellard.org/quickjs/) — 2026-10-17 確認、2026-06-04。
- [Q2: QuickJS C embedding manual](https://bellard.org/quickjs/quickjs.html#QuickJS-C-API) — ownership / exception / limits / bytecode の設計根拠。性能保証には使用しない。
- [Q3: QuickJS official `quickjs.h`](https://github.com/bellard/quickjs/blob/master/quickjs.h) — 2026-10-17 取得 blob `32a54fb2adcda957a5e989eb33e180591db1a29b`。release pin の代わりではなく、N1a で取り込む tarball と再照合。
- [M1: MoonBit FFI](https://docs.moonbitlang.com/en/latest/language/ffi.html) — target toolchain の header と ownership annotation を固定する。
- [N1: Node 24.21.0 process / nextTick](https://nodejs.org/download/release/v24.21.0/docs/api/process.html#when-to-use-queuemicrotask-vs-processnexttick)。
- [N2: Node 24.21.0 timers](https://nodejs.org/download/release/v24.21.0/docs/api/timers.html)。
- [N3: Node 24.21.0 EventEmitter](https://nodejs.org/download/release/v24.21.0/docs/api/events.html)。
- [N4: Node 24.21.0 CommonJS source documentation](https://github.com/nodejs/node/blob/v24.21.0/doc/api/modules.md)。
- [N5: Node 24.21.0 fs](https://nodejs.org/download/release/v24.21.0/docs/api/fs.html)。
- [N6: Node 24.21.0 Buffer](https://nodejs.org/download/release/v24.21.0/docs/api/buffer.html)。
- [N7: Node 24.21.0 URL](https://nodejs.org/download/release/v24.21.0/docs/api/url.html)。
- [T1: esbuild TypeScript semantics](https://esbuild.github.io/content-types/#typescript)。
- [E1: Electron ESM / preload matrix](https://www.electronjs.org/docs/latest/tutorial/esm)。

[Q1]: https://bellard.org/quickjs/
[Q2]: https://bellard.org/quickjs/quickjs.html#QuickJS-C-API
[Q3]: https://github.com/bellard/quickjs/blob/master/quickjs.h
[M1]: https://docs.moonbitlang.com/en/latest/language/ffi.html
[N1]: https://nodejs.org/download/release/v24.21.0/docs/api/process.html#when-to-use-queuemicrotask-vs-processnexttick
[N2]: https://nodejs.org/download/release/v24.21.0/docs/api/timers.html
[N3]: https://nodejs.org/download/release/v24.21.0/docs/api/events.html
[N4]: https://github.com/nodejs/node/blob/v24.21.0/doc/api/modules.md
[N5]: https://nodejs.org/download/release/v24.21.0/docs/api/fs.html
[N6]: https://nodejs.org/download/release/v24.21.0/docs/api/buffer.html
[N7]: https://nodejs.org/download/release/v24.21.0/docs/api/url.html
[T1]: https://esbuild.github.io/content-types/#typescript
[E1]: https://www.electronjs.org/docs/latest/tutorial/esm
