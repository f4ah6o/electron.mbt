# 0007: contextBridge の技術成立条件・renderer 安全境界・adapted bridge 設計

Status: polished
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: research/context-bridge-sender-oracle

## 概要

同期 contextBridge の成立調査と、Moji 用 adapted bridge の実装契約を分ける調査・設計 issue。P0 の理由は、特権境界と同期戻り値を誤認した実装が全 renderer の安全性・起動可否を左右するためである。利用者に見える成果は、最初の page script から API が使え、同期 disposer と Promise RPC が契約どおり動き、未知の方式を厳密互換と誤表示しないこと。

**最初の着手単位は B1 の sender/relay oracle と判定 schema。着手可能であり、strict の新しい解法を先に発見する必要はない。** native 実装へ許可を発行する B3/B4 と、strict の採用判断は後述の技術 gate に従う。

| 項目 | 内容 |
| --- | --- |
| Priority | P0 |
| Dependencies | [0005: 既存成果と統合](0005-existing-work-and-integration.md)、[0006: architecture / profiles](0006-runtime-architecture-and-profiles.md) |
| 上位計画 | [0004: 実用化ロードマップ](0004-production-readiness-roadmap.md) |
| 既存成果 | [PR #3: Node-less ADR](https://github.com/f4ah6o/electron.mbt/pull/3)、[PR #10: contextBridge prerequisites](https://github.com/f4ah6o/electron.mbt/pull/10)、[PR #13: native attestation event](https://github.com/f4ah6o/electron.mbt/pull/13) |
| 主対象 | macOS / Apple Silicon / public WKWebView API。Windows・Linux は各 backend の別 gate |
| 後続設計 | [0010: IPC・値・flow control](0010-ipc-values-and-flow-control.md) |
| 完了条件 | strict の bounded feasibility 判定、adapted の独立 security acceptance、native evidence、未対応範囲の記録 |

## 背景

### 1. 現在の事実と本書の決定

#### 1.1 調査した事実

| 対象 | 固定した HEAD / 状態 | 到達点 | 未実装・未証明 |
| --- | --- | --- | --- |
| PR #3 | `49ec04fac8f1db7212f98ade5a82128f1c4692e5` / open, draft | Node-less main を QuickJS とする ADR、strict 初版 No-Go、`electron-nodeless-adapted-v1` を別 profile とする設計 | QuickJS native execution、adapted native security、実アプリ E2E |
| PR #10 | `8f006f94c9ce580f5705af60f3402f49779d85cc` / open, draft / PR #2 上 | MoonBit handle registry、trusted Node main の JS reference 管理、独立 bootstrap/preload worlds、nonce・frame・document 照合 | `require('electron')`、`exposeInMainWorld`、renderer IPC、cross-realm function/Promise proxy |
| PR #13 | `9d73ebc6d6389f431f6664ae9f6acacf3fe30599` / open, draft / PR #10 上 | `isolated-preload-attested` の native one-shot event、MoonBit による session/generation/event ledger 検証 | event 単体での grant/readiness、任意 page request の sender 認証、production bridge |
| 既存 M0 probe | PR #10 の [feasibility 文書][R2] | real WKWebView で同期 DOM primitive、Promise reply、共有 DOM 返信改ざん、iframe relay、reload/grant 負例を観測 | unchanged Electron preload の strict 適合。probe の PASS は candidate 適合ではない |

PR 本文が報告する既存 CI 成功は、当該 PR の証跡である。本書作成時にその runtime/native tests を再実行したとは扱わない。`compatible:false`、`contextBridge:NOT_IMPLEMENTED`、M0 OPEN、通常 `run`/`pack` の fail-closed を維持する。

#### 1.2 本書が維持する設計判断

1. **strict Electron contextBridge は初版 No-Go / blocked。** public WKWebView で安全な同期 cross-realm proxy が未証明であることが理由であり、数学的な不可能性の主張ではない。
2. **Node-less の実用経路は PR #3 の adapted profile を独立して進める。** `preload adapted` / `App Scenario Supported` と表示し、元 preload の任意 closure を厳密互換として扱わない。
3. **strict の再調査は範囲と終了条件を固定した spike にする。** 同じ診断を繰り返して通常開発を無期限に止めない。新しい public primitive、変更した threat model、再現可能な根拠があるときだけ再開する。
4. **既存 Node profile と Node-less profile の証跡を分ける。** main engine の置換、renderer realm の隔離、同期 proxy の成立は独立の問題である。

今回の読み直しでも `bridges/node/electron-facade.cjs` は `contextBridge / ipcRenderer` を unsupported としており、同期 private socketpair のテストは renderer bridge の証拠ではない。[現 main facade](https://github.com/f4ah6o/electron.mbt/blob/8177cf051976b8d7b9eca25ae7ad8820bb04a719/bridges/node/electron-facade.cjs)

## 問題

現在の core/facade と private Main transport は、page/preload を跨ぐ同期 function proxy を提供しない。PR #13 の bootstrap/preload/load event だけでも、任意の renderer request の発信 document を証明できない。

さらに、全 adapted event を `Promise<disposer>` にすると Moji の同期 cleanup と合わず、full-load 後まで first RPC を待たせると初期化の循環を作り得る。これらは §6〜§8 の独立契約で扱い、strict 研究の終了と adapted の完了を同じ verdict にしない。

## 目標

最初の B1 では、固定 Electron 44.7.0 の direct child / authorized parent relay / shared-DOM reply 改ざんを同一 fixture で記録し、期待する native sender、許可 operation、実 effect を別 field にする。Moji の disposer/イベント基準は app の locked Electron 43.1.0 と区別する。全体の目標と対象外は旧 §2 を保持する。

### 2. Goal / Non-goal

1. Goal: privileged native control、host-installed bootstrap、app preload、page の責務と ownership を固定し、PR #10/#13 の安全な前提を再利用する。
2. Goal: strict を再評価できる oracle/attack matrix と go/no-go を作り、初版の adapted bridge に実装可能な Promise/イベント/寿命契約を与える。
3. Goal: first page script、偽造/replay、異常終了、reload、callback cleanup を実 native host で検証可能にする。
4. Non-goal: Electron 全 API 互換、`ipcRenderer.sendSync`、pageWorld への任意 privileged preload 実行、isolation/sandbox 無効化、private WebKit selector、CEF/Electron の隠れた fallback。
5. Non-goal: arbitrary malicious main/preload を実行する汎用 sandbox。Electron 型アプリの trusted main/preload と compromised renderer の間の境界を対象にする。
6. Non-goal: IPC 全体の Structured Clone、queue/deadline、main handler 実装の詳細。そちらは [0010](0010-ipc-values-and-flow-control.md) が所有する。

## 対象外

旧 §2 の Non-goal を適用する。B1 は既存 runtime の通常 `run/pack` を開く変更、元 preload の書換え、strict shim の完成を含まない。新しい public primitive を試す B5 は、B1 と fixture を共有して独立に着手する。

## 提案する方針

### 最初の bounded slice と変更箇所

1. `fixtures/oracle/preload.cjs` の同期値/throw/Promise/Set callback fixture と `scripts/oracle.cjs` の source hash 保全を読み、direct-sender/relay の観測を追加する小さい PR を作る。
2. 既存 `core/runtime.mbt` / `core/runtime_wbtest.mbt` の generation・grant・取消契約は保持する。B1 の expected/observed schema と不足 field の拒否を MoonBit の判定側へ追加し、native sender は人工値で検証済みとしない。
3. `docs/adr/` の sender decision、`fixtures/worlds/` の攻撃 fixture、`compatibility/` の scope/required observations は追加予定の成果物。B3 以降の `bridges/preload/` / native installation code は本 slice の完了へ混ぜない。
4. B1 は EP-06 の必須共有 ADR/oracle として独立に進め、EP-07 の strict 成功に依存させない。B5 は strict feasibility、B6 は strict Go 後の実装とする。B7 は profile 別の verification であり、adapted は B3/B4、strict は B6 の後に独立して実施する。

### 互換性と移行

既存 Node-backed の facade、M0 OPEN、strict の同期 signature を維持する。新 observation は versioned variant とし、旧 report に存在しない field を default の成功値で補完しない。generated adapter、元 preload 未実行、Moji の renderer bytes、native operation policy を別 hash/field で記録する。

### 3. ADR: 直接の sender と親 page による relay

#### 3.1 修正する曖昧さ

既存 M0 は、sandboxed child が parent に `postMessage` し、parent の公開経路が main-frame isolated handler を起動すると、native が元 child を識別できないことを負例として記録している。[R2] これは重要な観測だが、「直接の sender」と「過去の因果的な呼出し元」を同じ要求にしてはならない。

Electron も incoming IPC の sender/frame 検証を求める一方、app が公開した API を authorized parent が呼ぶこと自体は通常の機能である。[E2], [E6] 正規 parent が意図的に中継した child の存在を runtime が常に遡及検出する要求は、Electron より強い可能性がある。これは設計上の推論であり、以下の oracle 試験で確定する。

| 区分 | 所有する責務 | 必須判定 |
| --- | --- | --- |
| Direct sender | native/runtime | actual WebView/world/main-frame/document/origin を検証。JS 提出の同名 field を信頼しない |
| Public capability | trusted app adapter/preload | page に公開した各操作と引数を最小化。raw native control や任意 channel grant を公開しない |
| Parent relay | app の公開 wrapper | child の `MessageEvent.source/origin` を使う場合、その検証を wrapper が実施する。native-attested causal origin と表示しない |
| Response integrity | bridge/runtime | source realm の結果/例外を page の DOM listener が偽造できない。単なる page からの呼出し可否とは別の必須条件 |

#### 3.2 ADR acceptance

1. pinned Electron `44.7.0` と候補で、direct child、opaque-origin child、cross-origin child、same-origin frame、parent の明示 relay を同じ fixture で実行する。
2. 観測した `senderFrame`/origin、authorized method、native effect を分けて保存する。page が記述した `origin` や `source` label を native evidence に昇格しない。
3. runtime の責務を DirectSender と ResponseIntegrity、app の責務を公開 capability と relay policy としてレビューする。
4. oracle より強い制約を採るなら explicit profile restriction として記録する。既存の shared-DOM reply forgery は、この ADR で解決済みにならない。
5. ADR の native/oracle 証跡と独立レビューが揃うまで M0 判定を変更しない。

### 4. realm / process / ownership

| 所有者 | 保有する状態 | 禁止する結合 |
| --- | --- | --- |
| MoonBit Runtime | lifecycle、window/document epoch、grant、typed handle/quota、request terminal、diagnostics | JS function body、DOM/native object の直接操作 |
| native UI host | NSWindow/WKWebView、WKNavigation、message handler、trusted sender metadata、OS services | JS の sender 自己申告、UI thread と main JS の相互待ち |
| main JS engine | アプリ main、module loader、main handler/listener closure | preload/page の生 reference の持ち込み |
| bootstrap world | host-installed document evidence、private per-document nonce | arbitrary app preload、page-visible privileged endpoint |
| preload world | 元 preload の実 closure、restricted module shim、realm-local registry | independent bootstrap nonce/handler へのアクセス |
| page world | 公開 proxy/copied data、DOM/UI、adapted callback/disposer | arbitrary original privileged preload、private control fd/session/grant 操作 |

1. Node-less 製品は [0006](0006-runtime-architecture-and-profiles.md) の native supervisor/UI host 内の MoonBit core が権限の正本を所有し、main runner は別プロセスの trusted privileged principal とする。main は登録を要求できるが grant を独自発行しない。既存 Node-backed の topology と compiled core 配置はその検証系に維持する。
2. QuickJS main 案でも WKWebView の preload/page は JSC realm である。main を QuickJS に置き換えても `contextBridge` の同期問題は解消しない。
3. `WKContentWorld` は namespace であり、同一 name が同一 document という意味ではない。別 world でも DOM は共有される。[A1]
4. PR #10 の bootstrap と app preload の別 world、別 nonce、別 handler を維持する。preload 自身の status report は functional observation であり、malicious preload の安全証明ではない。[R4]
5. native control lane、attestation lane、application RPC lane を別権限にする。protocol の形式が同じ JSON でも `activate/grant/destroy` 等を renderer operation に追加しない。
6. 生の関数 reference は作成された realm が所有する。MoonBit は metadata のみ所有し、JS に二重の grant/ID/quota state machine を作らない。

### 5. public API の可否と strict の bounded 再調査

| 候補 | 一次資料/既存実測で分かること | strict 判断 / 次の作業 |
| --- | --- | --- |
| WKContentWorld + WithReply | namespace を隔離でき、postMessage は Promise を返す。[A1], [A2] | async native RPC の部品。同期 function proxy の証拠にはならない |
| 既存 DOM event + attributes | public primitive の同期実行を測れるが、現在の返信は page が改ざん可能。[R2] | production 昇格不可。修復案がなければ negative diagnostic のまま |
| 修復された renderer 内 public primitive | closure/first-script/integrity を満たす方式があれば候補になる | 現在未証明。脅威分析、使う public API、旧負例への改善を示してから spike |
| prompt delegate | frame を持つ string completion の public API。[A6] | 関数/Promise/入れ子 callback や reentry の根拠ではない。既定 transport に採用しない |
| UI thread block / nested event pump | 待機中に相手の JS/UI callback が必要になる可能性 | 相互待ちを作る解法は no-go。同期 API の勝手な Promise 化も不可 |
| WebView2 sync host object | sync native 呼出しはあるが、その間の JS callback は deadlock error となる。[W1] | Windows 独立 gate。名前に sync があるだけでは適合しない |
| WebKitGTK web process extension | frame/world の JSCContext を public API で取得できる。[L1] | Linux の別 spike 候補。macOS WKWebView へ類推しない |
| pageWorld preload / private API / CEF fallback | 既存の isolation・public API・非同梱要件から外れる | 本書では no-go。別 ADR なしに採用しない |

#### 5.1 調査の上限

1. 再調査を始める PR は、検証する public primitive を 1 つ、失敗を覆せる仮説を 1 つ、再現 fixture と終了判断を先に記載する。
2. 最初の checkpoint は、unchanged preload の同期 return/throw を最初の page script で実行し、page による response forgery が失敗すること。ここで失敗すれば機能追加へ進まない。
3. 次の checkpoint は callback・nested/reentrant call・Promise・frozen copy・navigation revocation を同じ方式で通すこと。別々の toy 実装の成功を合算しない。
4. 2 checkpoint の判定後に `go` / `no-go` / `blocked by named missing evidence` のいずれかを必ず残す。OS/compiler がない場合は未実行であり、技術的不可能を結論にしない。
5. no-go なら原因、失敗 fixture、対応 public API、再開に必要な新情報を ADR に残し、初版 adapted の作業を継続する。期限が来たことを理由に safety gate を通さない。

**2026-10-18 pre-registration:** B5 は [docs/0038](../../docs/0038-m0-context-bridge-spike.md)
で、修復候補を「synchronous cross-world `dispatchEvent` + 両 world の closure
にだけ渡す per-probe secret の HMAC + per-document sessionId/challenge」に限定
して開始する。checkpoint 1 は unchanged `fixtures/oracle/preload.cjs` の
first-script sync return/throw と page response forgery の失敗、checkpoint 2 は
callback・nested/reentrant・Promise・frozen copy・navigation revocation。失敗時は
機能追加を止め、`no-go` または named missing evidence を記録する。これは
production `contextBridge` の実装開始ではなく、B6 の前提を判定する test-only
spike である。

**2026-10-18 result:** macOS 26.5.2 / WebKit `21624.2.5.11.8` 上の test-only
spike は checkpoint 1（first-script sync return/throw、page forgery 不受容、
secret 非可視）と checkpoint 2（callback・nested/reentrant・Promise・frozen
copy・sandboxed child・reload/stale grant）を PASS し、decision を **go** とした。
unchanged oracle observation は pinned validator を満たした。ただしこれは
test-only の shared-DOM/HMAC candidate であり Electron の engine-level proxy
ではない。Electron baseline differential は local では NOT RUN（CI で収集後に
比較）、B6 の production loader・MoonBit authority/lifetime/bounds・native
sender/document authority・独立 security review は未実装である。strict
profile は **blocked** のまま、original preload は NOT_EXECUTED、
`compatible:false` と M0 OPEN は不変。詳細は
[docs/0038](../../docs/0038-m0-context-bridge-spike.md)。

### 6. native attestation と document lease

#### 6.1 PR #13 の再利用

`isolated-preload-attested` は current generation の通知であり、load ACK と race し得る。[R5] 既存 event は native navigation 完了と restricted preload の観測後に出る。MoonBit の既存 state machine に correlation を加え、JS で別の権限正本を作らない。この event の受信と、将来の bridge 呼出し admission を同じ状態にしない。

| 相関要素 | 信頼する出所 | 用途 |
| --- | --- | --- |
| runtime/session/window/generation/load request | private native transport / MoonBit | 別 runtime/window、古い load attempt の排除 |
| independent bootstrap observed | bootstrap world からの native WKScriptMessage | document-start の host script 観測 |
| preload status | preload world + native が照合した status | restricted preload の機能的完了。任意コードの安全証明ではない |
| native load complete | WKNavigation の実完了 | 成功/失敗/取消の判定 |
| event ID | PR #13 monotonic event ledger | duplicate/late event の排除 |
| document policy key | native securityOrigin、navigation と trusted app root | 許可 document の識別。URL と actual origin を同一視しない |
| allowed operations | native core が検証した trusted app manifest | main の登録要求と grant 正本を区別。event 受領で増やしてはならない権限 |

1. 既存 restricted-preload 経路では ACK→event、event→ACK の両順序を相関し、required conditions が揃うまでその load readiness を成立させない。duplicate event で load success を二重 emit しない。これだけで renderer IPC / strict bridge を grant しない。
2. failure/cancel/destroy/host-gone 後の ACK/event は document を再活性化させない。same URL reload も新 epoch とする。
3. `WKScriptMessage.webView/frameInfo/name/world` を native 側で照合する。[A4] header にある実 world を確認できる環境では、登録 world と一致することも判定する。
4. `forMainFrameOnly` user script だけに依存しない。named-world message handler 自体は全 frame に登録されるため、各受信で native `isMainFrame` を検証する。[A3]
5. `WKFrameInfo` は delegate 呼出しを跨ぐ stable frame identity ではない。[A5] pointer を永続 ID にせず、host-owned epoch/nonce、実 WebView、document policy と組み合わせる。
6. nonce は document ごとの replay 分離に使う。page に渡した識別子を秘密の bearer authority と称さず、native sender と現 lease の検証を省略しない。

上表の preload status は既存 restricted-preload 経路を表す。adapted profile が元 preload を実行しない場合、PR #13 の event を偽って生成しない。B3 で adapter installation の別 event/observation variant と required conditions を定義する。page proxy 自身の設置報告は functional observation とし、native sender/operation 認可の代わりにしない。`originalPreloadExecuted:false` と adapter/source hashes を証跡へ残す。

#### 6.2 adapted の ingress と load 完了を分離する

以下は B3 で追加する状態であり、PR #13 に実装済みの能力ではない。document の authorization と load outcome を独立した state とし、`Loaded → Attested → Authorized` の一本道を全 profile に強制しない。

| 状態 / observation | 成立条件 | 与える能力 |
| --- | --- | --- |
| `RoutePrepared` | native が manifest の固定 method/topic と document-start scripts を navigation 前に準備 | 予定された経路だけ。page の RPC 実行権限はまだない |
| `AdapterInstalled` | 対象 document に選定済み proxy が設置され、独立した functional observation が到着 | 設置の観測だけ。元 preload の実行・安全性・sender の証明ではない |
| `DocumentIngressReady` | native が実際の許可 main document/current epoch を識別し、independent bootstrap、adapter installation、route/schema の required observations が揃い、失効していない | manifest 内の RPC を毎回の native sender 検証を経て admission できる |
| `LoadComplete` | 実 WKNavigation 完了、profile 別 required observations、load request の ACK 相関が成立 | load 成功の一度だけの終端。first paint / ready-to-show は別観測 |

1. `DocumentIngressReady` に full `loadFile` ACK / `didFinishNavigation` を要求しない。native actual document の識別に必要な commit/epoch 観測と、ページ全体の load 完了を分ける。識別が public API で成立したことを実証するまで、この経路を有効化しない。
2. bootstrap / adapter installation の通知は application RPC、app の ready report、full load ACK を待たずに完了する。first call の返答を待つ app 初期化を、同じ call の admission 条件に入れない。
3. Moji は §7.1 の bounded first-call queue を採る。lease 未成立中の待機は authority を与えない。ready を page が偽造しても、native の現 document/operation 照合で未認可 request を拒否する。
4. readiness 前の reject / timeout / navigation / host loss で queue を終端化する。ready 前に捨てた request は Main handler に入れない。late ready による旧 queue の再生を禁止する。
5. ingress 後に load が失敗したら document を失効させ、pending/late reply を処理する。既に Main が受理した操作の副作用を取り消したとは主張しない。Main app principal と document grant の違いは [0010](0010-ipc-values-and-flow-control.md) / [0011](0011-app-loading-origin-and-storage.md) に従う。
6. first module の `await bridgeCall()` は実 WebKit の ordering fixture にする。ただし top-level await 単体が必ず window load / WK navigation 完了を止めるとは断定しない。[H1], [H2] 確実な循環待ち負例は、初回 RPC 応答まで load-blocking resource を完了させない fixture と state-machine の依存注入で別に再現する。

#### 6.3 navigation の未決定部分

same-document hash/history、failed provisional navigation、redirect、back/forward cache、WebContent process replacement は別 fixture にする。URL が変わっただけで旧 document を破棄したり、URL が同じだけで新 document を旧世代と認めたりしない。権限停止・最終失効の時点は pinned oracle と native lifecycle に合わせる。

### 7. adapted bridge の具体設計

#### 7.1 公開契約

PR #3 の `electron-nodeless-adapted-v1` は、目的別 Promise RPC と page 内の callback/disposer を使う。[R1] これは future implementation contract であり、現時点で利用可能な API ではない。

1. trusted adapter manifest が、公開メソッド名、固定 native operation、引数/返答 schema、許可 document、quota を宣言する。任意 channel を送れる `send(channel, ...args)` を page へ公開しない。
2. document-start で native が生成/選択した **特権を持たない page proxy** を設置する。元の privileged preload body を pageWorld へ移す方式ではない。
3. application RPC handler は page から直接見えてもよいが、bounded operation 以外の能力を持たず、native が actual sender/document を毎回認可する。bootstrap/control handlers は引き続き別 world に置く。
4. `call(method,args)` は Promise を返す。JSON文字列を executable JavaScript に埋め込んで返答せず、WithReply 等の native reply と typed codec を使う。
5. 初回の API object 設置と native lease の準備は別状態にする。Moji は最初の page script で API が存在し、Promise RPC の lease 待ちを bounded queue に入れる。同期 `onX` の local 登録はこの queue を待たない。
6. `loadFile` ACK を遅らせるだけでは page first-script ordering は修復できない。post-load の後付け注入は first-script acceptance を満たさない。
7. 既存 preload、生成 JS、adapted source、runtime wrapper の hashes を別記録にする。adapter が変えた API signature/behavior を一覧化し、`unchanged preload` と表示しない。

first-call queue は call 時に accepted codec で引数を snapshot し、後から mutable object を読み直さない。queue の件数、累積 byte、ready deadline を adapter manifest の必須数値とし、[0010](0010-ipc-values-and-flow-control.md) の document/runtime 合計予算内に収める。quota / validation / ready timeout は各 Promise を一度だけ reject し、暗黙 retry はしない。page leaf の pending resolver/local queue は authority ではなく、native admission と revoke の正本は MoonBit に置く。ready 通知後の送信にも actual sender/document の検証を必須とする。

#### 7.2 イベントと同期 disposer

Moji の元 preload は `onOpenDocument/onCloseRequest/onUpdateState` から同期に disposer を返し、renderer はそれを effect cleanup で直接呼ぶ。[M1], [M2] Promise に変えると renderer 契約が変わるため、次の variant を分ける。

| adapter variant | 公開契約 | native 資源との関係 |
| --- | --- | --- |
| Moji fixed topics | `onX(callback) -> () => void` | document ごとの固定 route と page-local listener。呼出しごとの native subscribe/unsubscribe はない |
| 明示的な動的 subscription | `subscribe(topic,callback) -> Promise<disposer>` | allowlist 内で native registration ACK を待つ。採用 app は renderer signature adaptation を明示 |

1. Moji では `doc:open`、`app:request-close`、`update:state` の native route を manifest から navigation/bootstrap 前に準備する。route の存在だけでは active grant にしない。native event は trusted Main transport、window、document epoch、固定 topic に束縛し、schema と生存を配送前に検証する。
2. document-start proxy が local listener table と purpose-specific `onX` を設置する。`onX` は page realm の callback を local record に保持し、同じ turn で同期 disposer を返す。callback / disposer の関数本体や JS object identity を native / 他 world へ送らない。
3. 同じ callback を 2 回登録しても別 record を作り、各 disposer は自分の record だけを解除する。disposer は冪等で、未開始の次回 event dispatch からその listener を外す。固定 native route は最後の listener の解除後も document 寿命まで保持し、document revoke / destruction で回収する。
4. 同一 event の emission 開始時 snapshot、callback 中の登録/解除/throw、引数 arity は Moji の locked Electron oracle と照合する。実行中 callback の巻戻しや、途中解除が既に始まった emission の全 callback を止める保証を加えない。document revoke 後に新しい event を開始せず、旧 queue を新 document へ転送しない。
5. 未購読 event の自動 replay / last-value cache を追加しない。native transport queue と app-level retained subscription を区別する。bootstrap との前後関係で buffer が必要なら bound・順序・no-listener 時の扱いを oracle / adapter 差分へ固定する。Moji の `getUpdateState()` による初期 snapshot を event replay で置き換えない。
6. adapter/route 準備失敗を `onX` の Promise rejection に変えない。local 登録成功は remote delivery 成功の約束ではない。startup/bridge terminal diagnostic と pending RPC の typed rejection で失敗を可視化し、最初から unavailable と判明した状態での公開 API の失敗形状は adapter contract に明記する。
7. overflow、malformed event、route loss、listener exception は理由・topic ID・epoch・queue count を内容/secret なしで記録する。必要な close request を配送できなかったときに正常 close/confirm を捏造しない。app の dirty guard と実 window 状態を保持し、失敗を runtime の診断面へ出す。main callback の承認を待たずに終了を進める代替挙動は追加しない。
8. 確定した navigation revoke、window destruction、renderer/main/host loss で document records と pending を終端化する。cancelable close の一時保留と永久失効を区別する。動的 variant の登録失敗は subscribe Promise を reject し、native unsubscribe の失敗は cleanup ledger と teardown で扱う。

diagnostic は `phase / reason / profileHash / adapterVariant / documentEpoch / topicId? / queueCount / observationSource` を持つ設計とし、正式 error code は [0013](0013-cli-diagnostics-and-developer-workflow.md) の prefix に合わせる。起動中の adapter/route failure は起動結果に、起動後の致命的な bridge failure は host 管理の診断面に表示し、renderer console だけへ捨てない。page が報告した listener exception / delivery acknowledgment は `page-functional` と明示し、native 側の dispatch/認可証跡や app の操作完了証明に昇格しない。

strict の「任意 preload 関数が任意関数を返す」と、この用途限定 page 内 disposer は別能力である。名称を合わせただけで strict `contextBridge` の callback/return profile を通過させない。

### 8. strict bridge の型・identity・error・Promise

#### 8.1 二つの codec

`contextBridge` は Function proxy と copied/frozen data を持ち、IPC は Structured Clone 制約を持つ。[E1], [E4] `BridgeValue` と `IpcValue` の設計を分離し、詳細な clone/transport は [0010](0010-ipc-values-and-flow-control.md) に委譲する。

| 値群 | strict bridge の要求 | IPC との違い / acceptance |
| --- | --- | --- |
| plain data | source から copy し、API data の nested freeze を検証 | source object を freeze して済ませない |
| Function/callback | source realm reference と target proxy、owner/kind/lifetime | IPC application payload の関数は通さない |
| Promise | real source/target Promise、fulfill/reject、microtask ordering | application argument の Promise と transport reply 待ちを混同しない |
| Error | copy後のname/message/tag/realmを pinned oracle で判定 | `ipcMain.handle` の Error はmessage中心の別変換。[E5] |
| numeric / binary / graph types | undefined/holes/-0/NaN/BigInt/buffer/cycle 等を型ごとに支持/拒否 | tiny JSON へ無音に縮退させない |
| class/prototype/Symbol/DOM等 | exact Electron version の profile で明示 | 最新文書の型追加を無試験で受理しない |

#### 8.2 function identity と寿命

1. PR #10 の MoonBit registry が authority、kind、monotonic non-reused ID、256/document・4096/runtime の quota を所有する。[R3] 制限拡大は別の測定/変更とする。
2. JS registry は actual closure/resolver を所有する。source の関数 body を文字列化して別 realm に再評価しない。
3. 同一関数を別々の call で渡した際の proxy identity を理想化しない。既存 oracle は direct `Set.delete(callback)` で解除できない観測を持つ。subscription/disposer の参照試験と区別する。[R2]
4. `this`、bound function、function returning function、callback returning value、再帰、callback内throwを別 case にする。class/constructor proxy は初期対象に加えない。
5. invoke 前後で authority/lifetime を再確認する。関数実行中に navigation/release/destroy が起きたら stale result/throw を新 document へ返さない。

#### 8.3 Error / Promise

1. 同期 throw は page の同じ turn の try/catch に届く必要がある。trusted Node main の同一 realm で throw しただけでは証明にならない。
2. Error の stack は許容する正規化だけ行い、name/message/tag/page-realm instanceof の期待を pinned oracle に保存する。native path/token を debug payload として page へ出さない。
3. Promise settlement は payload validation/copy が成功してから MoonBit record を consume し、JS reference を detach してから resolve/reject する。duplicate/late settlement を別 request に使わない。
4. thenable assimilation と microtask ordering を exact oracle で確認する。source/target Promise が同じ object identity を持つとは仮定しない。
5. revocation は pending Promise を typed failure にするが、source の既に始まった副作用を取り消したことにはならない。timeout による暗黙 retry を加えない。

#### 8.4 getters / Proxy / primordials

1. PR #10 の現在の JS leaf は trusted Node main 内であり、ブラウザ realm の実装ではない。[R3] Node 固有の型検査が JSC/QuickJS でも利用可能とは仮定しない。
2. arbitrary Proxy を純 JS だけで trap 実行なしに完全検出/拒否できる保証を置かない。`Object.getOwnPropertyDescriptors` 等も Proxy trap を起こし得る。
3. getters、revoked Proxy、callable thenable、prototype-sensitive key、cyclic graph を oracle に入れ、side effect と失敗時点を記録する。参考 runtime より強い制約は profile limitation として表示する。
4. realm-local primordials を早期取得しただけで安全証明とはしない。captured builtin に attacker-controlled object を渡した場合までレビューする。

#### 8.5 strict preload module shim

1. B5 go の後でのみ、sandboxed CJS の `require('electron')` と対象 globals/modules を追加する。Electron の sandboxed preload は全 Node 環境ではなく、通常の複数ファイル CJS loader とも異なる。[E3]
2. PR #10 の app-root containment、UTF-8、64 KiB 上限、source SHA の native 再照合を再利用する。`module.exports` wrapper の実行だけを Electron module support としない。
3. `Buffer/process/timers/events/url`、exports alias、entry path、unsupported require が catch された場合を個別 fixture にする。対応していない module に空 object を返さない。
4. `exposeInMainWorld` の duplicate/reserved apiKey、部分失敗、nested function、first-script ordering を検証する。登録途中の API を残さず、source の文字列置換で適合させない。

### 10. 実装場所と PR 分割

以下は新規実装先の提案。既存 PR の path/exports を確認して統合し、同じ registry/validator を別ファイルに複製しない。

| 単位 | 主な場所 | 依存と独立した完了判定 |
| --- | --- | --- |
| B1 sender ADR / oracle | `docs/adr/`、`fixtures/oracle/`、`scripts/oracle.cjs` | PR #3/#10。direct/relay/identity の観測と期待が区別され、candidate を誤昇格しない |
| B2 attestation correlation | `core/`、`transport/`、`platform/macos/`、PR #13 の native event adapter | PR #10/#13。既存restricted-preloadのACK/event両順序とstale/duplicate/failure後eventをnative試験 |
| B3 adapted manifest / page proxy | 新規 `bridges/preload/` のadapted adapter、`platform/macos/`、`compatibility/` | B1/B2、0006。adapter-install observation、ingress/loadの分離、bounded first-call queueをactual native senderで実証 |
| B4 adapted events / disposal | `bridges/preload/` のadapted page leaf、`core/`、`fixtures/` | B3/0010。Moji固定topicと同期local disposer、登録/配送/解除/revoke、diagnosticsのnative証跡 |
| B5 strict public primitive spike | test-only native probeと`fixtures/worlds/` | B1。§5のbounded go/no-go。失敗をprofile変更で隠さない |
| B6 strict preload shim / codec | isolated preload adapter、realm registry、MoonBit boundary | **B5 goの場合のみ**。B6-A exposure authority contract は実装済み。require/transport/page shim/type/error/callback の同一fixture acceptance は未達 |
| B6-A exposure authority (2026-10-18) | `core/context_bridge.mbt`, `bridge/context_bridge.mbt`, tests | 実装済み contract。API key/descriptor/クォータ/lifetime/`expose` dispatch のみ。transport・preload loader・native host・独立 review は未実装 |
| B6-B preload bridge environment (partial, 2026-10-18) | opt-in native preload surface、exposure event、MoonBit registration、test | `ELECTRON_MBT_B6_PRELOAD_BRIDGE=1` のみ。contextBridge descriptor/authority registration は実装、page API・transport・ipcRenderer/webUtils・Node-free preload environment は未実装 |
| B6-C experimental synchronous transport (2026-10-18) | host-owned `bridges/preload/` sources、install op、page/preload injection、document grant/report、oracle E2E | opt-in `ELECTRON_MBT_B6_TRANSPORT=1` のみ。unchanged oracle preload/page の pinned observation は PASS。page-admission ordering・独立 review・full preload globals/ipcRenderer/webUtils・frame policy は未達 |
| B6-D experimental semantics (2026-10-18) | edge preload/page、15 args/13 returns、callbacks/Promises/bounds/reload test、defect fixes | symbol key/sparse array/synchronous thenable race を修正。single API key・admission ordering・fault injection は未達 |
| B6-E evidence packet (2026-10-18) | baseline hook、CI evidence step、threat model/reviewer checklist | project owner が B6-C/B6-D transport を B7 design work 用に accept。strict admission/compatibility ではない。local baseline NOT RUN、external audit NOT RUN、strict promotion 不可 |
| B7 strict-profile admission (2026-10-18) | docs/0041、arbitrary-key 実験 3 件（失敗・revert）、preload key preview（experimental M1）、page-admission/strict-runtime gates | experimental M1 では single arbitrary key を preview→host→page shim で support。strict nodeless runtime への port、page-admission ordering、full preload、frame/self-DoS、strict runtime evidence が未達。strict profile は planned/blocked |
| B7 exact profile evidence | `compatibility/`、native/Node-less CI、evidence validator | B3/B4またはB6、0010。profile別required caseとnegative全てのnative証跡 |

1. B1/B2 と main engine の実装は並行可能。B5 が no-go でも B3/B4 の独立した adapted 実装を止める必要はない。
2. B2 は PR #13 の実装を包含する。#10/#13 の branch を飛ばして同名 feature を新規実装しない。stack の exact base/head を各 PR に記載する。
3. B3 は typed fixture による安全性、B4 は lifetime、B7 は実アプリ操作と配布profileを検証し、成功段階を分ける。
4. この文書追加で既存 PR の merge、通常 run/pack の有効化、manifest verified への昇格は行わない。

## 受け入れ条件

### 最初の slice の完了条件

- [ ] Given 固定 oracle と unchanged fixture、when direct child と明示 parent relay を実行、then sender observation と app の公開能力を区別した trace が残る。
- [ ] Given 同じ fixture の shared-DOM reply 改ざん、when 比較器を実行、then authentic result と forged value の差を記録し、sender ADR への賛成だけで forgery を解消扱いにしない。
- [ ] Given 必須観測を削除・null・wrong-type にした report、when validation、then invalid evidence とし、candidate の verified を生成しない。
- [ ] Given B1 の結果が FAIL / NOT RUN、when 台帳を更新、then不足条件と適用 scope を保持し、研究の完了と strict の成立を分ける。

次の 33 case は whole-issue の受入であり、B1 単独で全件 PASS を要求しない。

### 11. Given / When / Then acceptance

全項目が本書作成時 **未実行**。既存の PASS は exact revision の証跡として再利用し、profile の required case を欠いたまま集約しない。

| ID | Given / When | Then: 必須の観測 |
| --- | --- | --- |
| S01 | unchanged strict preload / pageの最初のscriptでcall | 同期 return/throw。Promiseへの置換・後注入がない |
| S02 | strict sourceがPromise/関数/Errorを返す / pageで受領 | exact oracleの型・realm・ordering・proxy挙動 |
| S03 | nested公開data / sourceとpageが別々に変更 | copy/freeze規則が成立し、mutabilityがrealmを越えない |
| S04 | pageがprototype/globalを汚染 / preload操作 | private state/primordials/privilegeが汚染されない |
| S05 | pageがshared-DOM reply listenerを後付け / strict call | authentic result/throwが保たれ、forged replyを受け入れない |
| A01 | adapted manifest / 最初のpage script | 目的別proxyが存在し、Promise contract/lease待ち上限が明示通り |
| A02 | Moji固定topic / native event、dispose、queued eventが競合 | 同期local解除、次回emission除外、実行中snapshotはoracle通り。native routeはdocument teardownで回収 |
| A03 | adapted original/adapter assets / 実アプリ操作 | separate hash/変更点を記録し、unchanged-preload互換を称さない |
| A04 | 元Moji renderer / 同一callback二重登録、effect cleanup、native準備遅延 | onXはPromiseでなく同期disposer。各record独立、冪等解除、登録のためのnative ACK待ちなし |
| A05 | topic eventがlocal listener前に到着 / 登録とgetUpdateState | 無断のevent replay/cacheがなく、初期state取得とpushを別に検証 |
| A06 | adapter install失敗、event overflow/route loss / 起動またはdirty close | diagnosticsで障害が見え、pendingは終端化。fake load/close成功やsilent dropによるPASSなし |
| N01 | private handler / child・foreign world・別windowから直接call | actual native sender照合で拒否。user scriptのmain-frame設定だけに依存しない |
| N02 | child postMessage / authorized parentがrelay | sender ADRとoracleの期待に従う。causal originを捏造しない |
| N03 | valid document / bodyのwindow/frame/origin/grant/sessionを偽造 | renderer metadataでauthorityを上書きできない |
| N04 | restricted-preload load / ACK→event、event→ACK、duplicate、failure→late event | profileのload joinを単発で終端化。event単体をbridge grantにせず、adaptedの早期ingressとは区別 |
| N05 | old lease/handle / same URL reload、cross URL、destroy | 旧callback/Promise/結果が新documentへ届かない |
| N06 | live function/callback/promise / foreign channel/runtime・wrong kindでuse/release | side effect前に拒否し、他recordを破棄しない |
| N07 | callback登録 / 同じ関数を再送、直接remove、返されたdisposer実行 | pinned oracleと同じidentity/解除。期待を理想化しない |
| N08 | user function実行中 / nested call、release、navigation、throw | 返答前の再検証でstale return/throwを拒否 |
| N09 | typed values / getters・Proxy・thenable・cycles・oversize・bad ID | silent conversion/privilege escapeがなく、side effect/失敗点を記録 |
| N10 | pending作業 / host SIGKILL、main loss、WebContent death | 1回reject/cleanup。normal終了を偽装しない |
| N11 | close/quit pending / appがcancel | 一時停止したlive handleを復帰し、永久失効と混同しない |
| N12 | repeated load/subscribe/dispose / 1000 cycles | retained数が収束、quotaが回復。GC/RSSは別測定 |
| N13 | main-frame許可 / redirect、opaque/inherited origin、failed load | native document policyに従い許可/拒否し、URL prefixでは認可しない |
| N14 | async副作用実行 / transport timeout・late complete | 自動再実行せず、旧documentへ返答しない |
| N15 | 任意preload loop/再帰 / host操作・watchdog | UIの停止性を実測し、未成立ならblocked。同期mutual waitを導入しない |
| N16 | actual許可documentの初回RPC / native load完了をまだ通知しない | 独立bootstrap/adapter観測でingress成立後に返答でき、full load ACK依存がない |
| N17 | 初回RPC結果までload-blocking resource/初期化完了を保留 | load待ちqueueとの循環を生じさせない。top-level await単体のordering試験と区別 |
| N18 | lease待ちのcall / 引数変更、過大queue、ready deadline超過 | call時snapshot、件数/byte上限、typed reject。flush時にmutable値を再取得しない |
| N19 | pageがadapter-readyを偽造 / wrong document、元preload未実行 | native sender/epoch認可を迂回できず、adapter-installとisolated-preload-attestedを混同しない |
| N20 | ready前のcall / revoke後にlate ready | queued callはMain handlerへ到達せず、新documentへ移動/再実行されない |
| N21 | fixed native event / 他window、旧epoch、未知topic、bad schema | 配送前に拒否し、他listenerへcallbackしない。診断にpayload/secretを出さない |
| N22 | local event emission / callback中に他listener解除、再登録、throw | pinned app oracleと順序/arity/例外を照合。未来eventの解除と実行中snapshotを区別 |

## テスト計画

### 確認した entry と実行計画

今回読んだ実装は `fixtures/oracle/preload.cjs`、`core/runtime.mbt`、`scripts/macos-probe.cjs`、`tests/macos-probe-validation.test.cjs`。fixture の `syncValue / syncThrow / promiseValue / add / remove` と、`observed:{}` を既存テストが受理する入力を確認した。source 読取は native 実測ではない。

| command / 手順 | 前提と確認範囲 | 今回 |
| --- | --- | --- |
| `node --test tests/macos-probe-validation.test.cjs` | B1/EP-01 の欠測負例を追加後に実行。既存 clean-PASS テストだけでは改修完了にならない | NOT RUN |
| `moon test --target js`、`moon test --target native` | 固定 toolchain。core generation/grant/terminal の回帰 | NOT RUN |
| `node scripts/oracle.cjs "$ELECTRON_MBT_ORACLE_EXE"` | shell 変数へ別途取得した Electron 44.7.0 の絶対 executable path を設定。reference のみ | NOT RUN |
| `node scripts/macos-probe.cjs --build-only` | macOS SDK/Xcode。3 probe の compile のみ | NOT RUN |
| B3/B4 の actual native admission / event case | 実装 PR で runner と command を追加する。現在の probe を production acceptance command と呼ばない | NOT RUN |

runtime を変更しない文書整備のため、ここでは runtime/oracle/GUI コマンドを実行していない。`scripts/m0-bridge-probe.cjs` 等の PR 内 entry は該当 HEAD の統合後に確認し、現在の main に存在する entry と区別する。

### 12. 証跡・go/no-go・終了条件

1. evidence は profile ID/hash、source mode、adapter variant/hash、original-preload実行有無、renderer/source/generated hashes、required observations、oracle/candidate exact revision、OS/SDK/CPU/WebKit/engine、command、各 observation、native effect、exit status、`PASS/FAIL/NOT_RUN/SKIP` を持つ。秘密の nonce/session は記録しない。
2. 既存 `scripts/m0-bridge-probe.cjs` の diagnostic PASS、`scripts/oracle.cjs` の reference PASS、native candidate acceptance PASS を別の欄にする。Linux で macOS test を SKIP した結果は macOS PASS ではない。
3. strict go: unchanged fixtureの S01〜S05、関数/Promise/identity/lifetime、required negatives、source/result integrityの独立レビューが同じ candidate で成立し、ADRを更新した場合のみ。
4. strict no-go: public primitiveが同期性・integrity・first-script・required callback契約のいずれかを満たせない。初版blockedを維持し、理由と再開条件を固定する。環境不足はNOT_RUN/blockedとして区別する。
5. adapted go: A01〜A06、variant別required negatives、native actual-sender/lease、循環待ちのないingress/load分離、Promise/event/disposal、selected app scenarioの証跡が揃う。これはstrict gateを閉じない。
6. adapted no-go: false sender authorization、forged reply、stale document delivery、hidden original preload downgrade、無期限UI停止、unbounded resource retentionのいずれかが残る。profileをverifiedにしない。
7. 終了時は「何が新しく動くか」「許されるsource/config adaptation」「依然unsupportedなAPI」「実行したnative test」をprofileごとに記載する。通常run/pack/リリースの最終判断は[0004](0004-production-readiness-roadmap.md)のgateへ戻す。

## リスク

実 world / frame / document と page の自己申告を混同すると、正規 API の範囲を超える grant と stale reply を発生させる。B1 の比較結果をもとに責務を固定し、public API の可能性が不明な箇所は次表の scope だけを保留する。native pending の取消と Main が受理済みの副作用は別の状態である。

### 9. cleanup / failure / 停止性

1. navigation/invalidate/destroy/stop で MoonBit record と realm-local reference を同じ transition で撤去する。public callback が実行中の場合は返答前の再検証で stale delivery を防ぐ。
2. close/quit の保留中は利用を止め、cancel で復帰する既存仕様を保持する。authorization error をすべて永久 revoke と扱わない。
3. host SIGKILL、main death、WebContent termination で pending を一度だけ失敗させる。異常終了から normal `closed` を合成しない。
4. registry 件数 0 は GC 完了の証明ではない。repeated reload/subscription で retained count、native allocation、RSSを別記録する。
5. native/control request timeout とユーザー操作・任意 async app handler の完了期限を区別する。詳細は [0010](0010-ipc-values-and-flow-control.md)。同期 bridge のために UI thread を無期限停止させない。

## 未解決の質問

| 質問 / 精確な保留 scope | Owner role | 必要な根拠・再開条件 |
| --- | --- | --- |
| 現 public WKWebView API で同期 return/throw・callback・result integrity を同時に満たす primitive はあるか。strict の有効化を blocked に保つ | WebView / security | B5 の 2 checkpoint、旧負例への反証、同一方式の callback/Promise/lifetime trace。失敗は理由付き No-Go、実機不足は NOT RUN |
| full load 完了前に native actual document と current epoch を結べるか。adapted production RPC admission の有効化だけを保留 | native / core | §6.2、N16〜N21 の actual WKWebView evidence と独立 review。page-ready report や WKFrameInfo pointer を代用品にしない |
| provisional failure / same-document / BFCache / WebContent replacement でいつ pause/revoke/restore するか。該当 navigation variant の認可を保留 | native lifecycle / security | §6.3 の oracle と実 native event correlation、旧 handle が復活しない負例。未実証 variant は許可しない |

B1 oracle、B2 統合、local listener/codec の contract 実装、拒否専用の native ingress の準備は上記と並行して着手できる。

## 変更履歴

- 2026-10-18: B5 repaired-primitive spike の test-only 実測を追記。checkpoint 1/2 PASS・decision go（tested macOS/WebKit）だが、M0 は OPEN、strict は blocked、B6 と独立 review は未達。

- 2026-10-18: B6-A exposure authority、B6-B preload environment、B6-C transport E2E、B6-D semantics matrix、B6-E evidence packet を実装/準備。B6-C/B6-D transport は project owner が B7 design work 用に accept。B7 plan と arbitrary-key 実験結果を docs/0041 に記録（MoonBit exposure registry、quotas/duplicate/lifetime、private `expose`/`release-exposure` dispatch、JS/native/Node tests）。transport・preload loader・page shim・native host integration・独立 review は未達のため strict は blocked、original preload は NOT_EXECUTED。設計は `docs/0039`。

- 2026-10-17: ユーザー指示により `issues/open` から `issues/polished` へ移動し、`Status: polished` と現行参照を同期。実装の準備状態・未解決事項・受入証拠は変更していない。

- 2026-10-17: polish-issue により metadata と必須構成を統一し、B1 の最初の slice、実在 command、scope 別の未解決事項、source/PR の読取根拠を追加した。旧 §1〜§13、S/A/N の全 33 ID、SHA・一次資料・Moji disposer と file authority の境界を保持した。 runtime/API の実装変更や互換状態の昇格は行っていない。

## 注記

- 2026-10-17: ユーザー指示「mv to issues/polished」に従い、整備済みの計画を open から polished へ移動。未解決事項・依存条件・runtime の未受入は本文に保持する。

### 準備状態・格納先・確認基点

初回 B1 と contract/negative fixture の作業は着手可能。strict production と adapted early native ingress は上の技術条件を満たすまで保留する。既存 PR 未統合は通常の統合依存として追跡し、調査を始められない理由へ広げない。

**状態と配置:** 2026-10-17 のユーザー指示により `open` から `polished` へ移動した。現在の保存先は `issues/polished/0007-context-bridge-feasibility-and-security.md`。`polished` は計画の整備状態であり、runtime の受入や未解決事項の解消を示さない。着手は本文の準備状態・依存条件に従い、受入は [AGENTS.md](../../AGENTS.md) と各試験の実証で判断する。進捗と再開条件は本ファイルへ記録する。

Branch は最初の実装 PR の候補名である。今回の本文整備は main 向けで、ブランチ作成済みという意味ではない。旧番号付き節を小見出しとして保持したため、既存の § 番号と fixture ID を引き続き参照できる。

文書の取得基点は main `8177cf051976b8d7b9eca25ae7ad8820bb04a719`。2026-10-17 の runtime 調査基点 `30c6fc97186e7ecfc8397c799525f00c8e4f0f65` と既存 PR の固定 HEAD は、履歴上の根拠として維持する。本文の公式文書引用は contract の参照であり、実装済み・native PASS の代用ではない。

### 13. 参照

公式文書は取得時点の contract 理解に用い、互換判定は exact Electron oracle を使う。Apple 文書が JavaScript 要求で本文取得に制約がある箇所は、Apple が公開する WebKit header を読んだ。将来 OS 用 API を現在のminimum OSで使用可能とは仮定しない。

[R1]: https://github.com/f4ah6o/electron.mbt/blob/49ec04fac8f1db7212f98ade5a82128f1c4692e5/docs/adr/0001-nodeless-macos-runtime-decisions.md
[R2]: https://github.com/f4ah6o/electron.mbt/blob/8f006f94c9ce580f5705af60f3402f49779d85cc/docs/0003-m0-contextbridge-feasibility.md
[R3]: https://github.com/f4ah6o/electron.mbt/blob/8f006f94c9ce580f5705af60f3402f49779d85cc/docs/0005-contextbridge-js-registry.md
[R4]: https://github.com/f4ah6o/electron.mbt/blob/8f006f94c9ce580f5705af60f3402f49779d85cc/docs/0007-contextbridge-cjs-preload.md
[R5]: https://github.com/f4ah6o/electron.mbt/blob/9d73ebc6d6389f431f6664ae9f6acacf3fe30599/docs/0008-native-isolated-attestation-events.md
[E1]: https://www.electronjs.org/docs/latest/api/context-bridge
[E2]: https://www.electronjs.org/docs/latest/tutorial/context-isolation
[E3]: https://www.electronjs.org/docs/latest/tutorial/sandbox
[E4]: https://www.electronjs.org/docs/latest/api/ipc-renderer
[E5]: https://www.electronjs.org/docs/latest/api/ipc-main
[E6]: https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages
[A1]: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKContentWorld.h
[A2]: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKScriptMessageHandlerWithReply.h
[A3]: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKUserContentController.h
[A4]: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKScriptMessage.h
[A5]: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKFrameInfo.h
[A6]: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKUIDelegate.h
[W1]: https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.addhostobjecttoscript?view=webview2-dotnet-1.0.4191.47
[L1]: https://webkitgtk.org/reference/webkitgtk-web-process-extension/stable/method.Frame.get_js_context_for_script_world.html
[M1]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/preload.ts
[M2]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/src/App.tsx
[H1]: https://html.spec.whatwg.org/multipage/scripting.html#execute-the-script-element
[H2]: https://html.spec.whatwg.org/multipage/webappapis.html#run-a-module-script
