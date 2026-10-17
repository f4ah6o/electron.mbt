# 0020: 実装作業・依存関係・PR分割・受入ゲート

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / 下記32作業は計画。実装完了を意味しない |
| 基準 | 2026-10-17、mainと既存PRのrevisionは [0005](0005-existing-work-and-integration.md) |
| 親 | [0004 実用化ロードマップ](0004-production-readiness-roadmap.md) |
| 設計 | [0006](0006-runtime-architecture-and-profiles.md)〜[0019](0019-native-interaction-and-accessibility.md) |
| 判断・保守 | [0021](0021-decisions-risks-and-maintenance.md) |

## 1. 作業の切り方

各EPは一つの追跡単位であり、一つの巨大PRにする指示ではない。独立したcontract、実装、production wiring、negative testをreviewできる大きさに分割する。既存PRを引き継ぐ作業は、元PRの成果と修正履歴を残す。依存PRを毎回コピーして新規実装扱いにしない。

1. **着手可能**は必要な契約・fixtureが揃った状態。**完了**は対象SHAの実装、公開面、required tests、証跡、未対応表示が揃った状態。
2. tableの依存は最小の実装・統合依存。文書間の関連リンクを実行依存に変換しない。準備用のfixture/調査は先行できる。
3. `S0`〜`S5`は0004の製品stage、`M0`〜`M4`は0001、`N0`〜`N6`はPR #3のgate。0008の`R1`〜`R4`はengine/loader内の実装順であり、製品stageとは別である。
4. 予定pathは既存fileを除き未作成。実装PRが最終package構成・command名を決める。空package、空stub、fake successを作っただけでは完了しない。
5. 担当は必要な役割の提案であり、特定の人を割り当て済みとはしない。security/data-loss/false-successのレビューは実装者以外が担当する。

## 2. 実行依存の一覧

工数は既存知識を持つ実装者の**人日レンジ案**。レビュー・対象テストの初期実装を含むが、外部署名審査、環境調達、upstream障害の待ちは含まない。未確認のboot閉包やFFI欠陥が判明したら再見積りし、日付だけを維持してscopeを隠さない。

| ID | 作業 | 直接依存 | stage | 主担当role | 人日案 |
| --- | --- | --- | --- | --- | --- |
| EP-01 | evidence admissionとprobeの誤成功修正 | — | S0 | QA / core | 3–6 |
| EP-02 | listener/invoke/codec stack統合 | EP-01 | S1 | core / JS境界 | 4–7 |
| EP-03 | native hostの最新main統合 | EP-01 | S1 | native / 統合 | 5–9 |
| EP-04 | isolated bootstrap/attestation統合 | EP-03 | S1 | native / security | 3–5 |
| EP-05 | 固定app build・boot閉包・oracle | — | S0 | app / QA | 4–7 |
| EP-06 | profile・所有権・manifest契約 | EP-01, EP-05 | S0 | architecture / core | 3–5 |
| EP-07 | strict bridgeの有限feasibility判定 | EP-04, EP-06 | S1 | WebView / security | 7–10 |
| EP-08 | QuickJS vendor・C ABI・最小eval | EP-06 | S1 | MoonBit / C | 4–7 |
| EP-09 | jobs・timers・GC root・停止性 | EP-08 | S1 | engine / core | 5–9 |
| EP-10 | native supervisor・private sync RPC | EP-03, EP-06, EP-08 | S1 | native / core | 6–10 |
| EP-11 | CJS loader・identity・resolution | EP-05, EP-09 | S2 | engine / loader | 5–8 |
| EP-12 | 必要Node symbolsとboot adaptation | EP-05, EP-11 | S2 | loader / app | 8–15 |
| EP-13 | adapted page API・local listener | EP-04, EP-06 | S2 | WebView / JS境界 | 6–10 |
| EP-14 | native sender・IPC production接続 | EP-02, EP-10, EP-13, EP-15 | S2 | core / security | 5–9 |
| EP-15 | source snapshot・origin・navigation | EP-03, EP-06 | S1–S2 | native / storage | 5–8 |
| EP-16 | file broker・通常保存・復旧 | EP-12, EP-14, EP-15 | S2 | storage / security | 7–12 |
| EP-17 | app/window lifecycle・event | EP-04, EP-09, EP-10 | S2 | native / core | 5–9 |
| EP-18 | dialog・Menu・clipboard・OS入口 | EP-14, EP-16, EP-17 | S2 | native / desktop | 7–12 |
| EP-19 | data store・single instance・再起動 | EP-12, EP-15, EP-16, EP-17 | S2 | native / storage | 4–7 |
| EP-20 | native CLI・診断・run admission | EP-06, EP-10, EP-11 | S2 | CLI / core | 4–7 |
| EP-21 | Moji M1〜M3とjmd拒否受入 | EP-05, EP-12, EP-14, EP-16, EP-17, EP-18, EP-19, EP-20 | S3 | app / QA | 6–10 |
| EP-22 | 統合security・fault・resource監査 | EP-14, EP-16, EP-17 | S3 | 独立security / QA | 5–9 |
| EP-23 | 実機IME・focus・AX・日常操作 | EP-18, EP-21 | S3 | native / QA | 5–10 |
| EP-24 | bundle・native pack・SBOM | EP-05, EP-12, EP-20, EP-32 | S4 | release / build | 5–9 |
| EP-25 | 署名・notarization・clean install | EP-21, EP-22, EP-24 | S4 | release / native | 3–6 |
| EP-26 | 配布量・全process・起動・soak | EP-21, EP-24 | S4 | performance / QA | 4–7 |
| EP-27 | preview判定・利用手順・再現性 | EP-07, EP-23, EP-25, EP-26 | S4 | release owner / QA | 4–7 |
| EP-28 | 更新・migration・rollback | EP-19, EP-27 | S5 | release / storage | 8–15 |
| EP-29 | Linux backendの最初の限定受入 | EP-27 | S5 | Linux / WebKitGTK | 8–15 |
| EP-30 | Windows backendの最初の限定受入 | EP-27 | S5 | Windows / WebView2 | 10–18 |
| EP-31 | ESM・追加API・二次app拡張 | EP-11, EP-12, EP-27 | S5 | loader / app | 8–15 |
| EP-32 | license・更新責任・保守台帳 | EP-06 | S0–S4 | maintainer / release | 3–5 |

EP-07の依存完了は**有限spikeの判定・証跡を揃えること**であり、strict Goを要求しない。No-Goの根拠を残して完了できる。EP-13/14は自身のnative security gateがFAILなら進めない。EP-29/30はportable fixtureやAPI調査を早期に準備できるが、表の完了対象である製品backendの受入はmacOS preview後とする。

0007のB1はEP-06、B2はEP-04、B3/B4はEP-13/14/15、B5はEP-07に対応する。B7のadapted統合証拠はEP-21/22/27で揃える。B6とstrictのB7はB5 Go後に追加作業と工数を作り、EP-07の7–10人日へ含めない。PR #3のN1aに含まれるCJS cache/cycle/identityはEP-11まで必要であり、S1のABI/jobs成功だけでN1a完了とはしない。

## 3. S0：誤成功の排除と入力固定

### EP-01 — Evidence admission

- **How:** PR #8を既存baseline validatorへ統合し、PR #6に残るmissing observations、DOM clipboard opt-in、NSNull shapeの判定を修正する。`scripts/`、`tests/macos-probe-validation.test.cjs`、macOS probe、report schemaが対象。
- **PR分割:** baseline semantic admission → missing/null validator negative → clipboard side-effect gateとnative malformed input。実機変更とportable validatorを混ぜて一つのPASSにしない。
- **What:** observed欠損、null、wrong type、wrong oracle/hash、synthetic candidate、timeoutでcompatibleへ昇格しない。opt-inなしで一般clipboard変更0。詳細は0005/0015。
- **出口:** 対象main SHAと各負例が一致し、mainに残る既知欠陥を閉じた証拠がある。既存テストだけのPASSでは不可。

### EP-05 — App input / boot oracle

- **How:** `compatibility/apps/`、`fixtures/apps/`へimmutable app registry、fetch/build manifest、symbol/dependency closureを追加する。Moji v1.0.5とjmd v0.2.3のoriginal/prepared/adapter hashesを分ける。
- **PR分割:** 原本/lock inventory → locked build/typecheck → emitted module inventory → upstream起動・first-use baseline。
- **What:** Moji eager updater/zlib/Buffer、初回getSettings/getUpdateState/onX、userData overrideを漏らさない。jmd privileged protocol要求をnegativeとして固定する。
- **出口:** source読取だけでなく実際のbuild出力と起動traceがある。updaterを維持実装するか明示adaptationするかをADRで決め、起動閉包がunknownのままS2の必要shimを確定しない。

### EP-06 — Profile and authority contract

- **How:** 0006のprofileとnative MoonBit authority正本をADR/manifest schemaへ反映する。0007 B1のdirect-sender/authorized-parent relayを区別するADRとpinned oracleを必須成果物にする。これはstrict spikeとadapted双方で共有する。既存Node-backedとの共存範囲を明示して`AGENTS.md`の実装適用範囲を整える。今回の文書追加だけで既存instructionを書き換え済みとはしない。
- **PR分割:** ADR/profile schema → admission/diagnostics → internal ownership types。
- **What:** inputMode、preloadMode、dependency/behavior adaptations、runtime engine、evidence profileの交差組合せ。TS+generated adapterを同時に表現し、Node版証拠をstrictへ転用できない。
- **出口:** IDs/grants/request terminalの唯一のowner、Main/AppPrincipalとrenderer/DocumentLeaseの違い、native leaf境界がレビュー済み。既存通常run/packのgateは維持。

### EP-32 — License and maintenance ownership

- **How:** 0021のcomponent/update matrix、root licenseの所有者判断、NOTICE/SBOMの入力を追加する。QuickJS/app rootのMITをproject licenseへ流用しない。
- **What:** 実bundle componentの由来、license obligations、upstream pin更新時の再試験範囲、security報告から修正版までの担当roleが追跡できる。
- **出口:** 配布に必要なlicense方針と依存台帳が確定し、未決のままEP-24/25をrelease-readyにしない。継続保守そのものを一度のPRで完了扱いにしない。

## 4. S1：既存成果の統合とnative/engine基盤

### EP-02 — IPC core stack

- **How:** #9 → #11 → #12の順で最新統合baseへ載せる。`core/`、Node leaf、facade、codec、oracle fixtureを再利用する。
- **What:** duplicate listeners、most-recent remove、nested once、handleOnce admission、captured handler、undefined、revoked result、thenable/getter、boundsを維持。
- **出口:** JS/native coreとNode leafが同SHAでPASS。16 scenarioのsynthetic candidateという証拠範囲を保持し、renderer E2E完成としない。

### EP-03 — Native host integration

- **How:** #2のmain競合を別checkoutで解消し、#4のdata/ready/quit/JSON修正と#7のtoolchain pinを保つ。`platform/macos/`、private transport、core dispatch、host testが対象。
- **What:** actual native ACK、window geometry、same-file reload、old WKNavigation拒否、cancel、FD/child rollback。レビューthread34件のうちoutdated未解決23件を根拠付きtriageする。
- **出口:** 新mainとの統合SHAでportable/Node/macOS/faultを再実行し、競合箇所と保持したbehaviorをレビューできる。古いHEADのCIを代用しない。

### EP-04 — Bootstrap and attestation

- **How:** #10 → #13をEP-03へ順に統合する。isolated handler exposure、one-shot native event、status readbackの契約を保つ。
- **What:** failed/caught-unsupported preloadがattestされない、one-shot、reload/host loss、attestation/load laneの逆順と旧generation。
- **出口:** PR #13のoriginal-preload proofとして接続済み。adapted adapter-install proofと任意page senderの証明は別作業に残す。

### EP-07 — Strict feasibility decision

- **How:** 0007の **B5 strict public primitive spike** とfeasibility evidenceを有限の実験計画へ落とす。B1のsender ADRはEP-06を使う。公開WebKit API、native frame/world、realm/proxy/callback/同期return、page first-script、DOM spoofを同一fixtureで調べる。B3/B4のadapted実装はEP-13/14、B6/B7のstrict製品shim/verificationはGo後の別作業へ分ける。
- **What:** Main sync RPCの成功をcross-world sync proofにしない。parentが意図的にrelayするケースのElectron参照結果と、direct child forgeryを別記録する。
- **出口:** Goなら全required fixtureと公開APIの実証、No-Goなら失敗する最小case・残る仮説・再開triggerが揃う。timebox案は7–10人日。時間満了をGoにせず、新たな根拠なしで同じspikeを無限反復しない。

### EP-08 — QuickJS C ABI

- **How:** `vendor/quickjs/lock.json`、`bridges/embedded-js/`、MoonBit native FFIを追加し、2026-06-04 source/build hashを検証する。任意QuickJS bytecodeを入力として受け付けない。
- **What:** eval/return/throw/string/buffer、所有権transfer、borrowed値の保持拒否、partial-create cleanup、非所有threadからのcall拒否。
- **出口:** native実行、C ABI ownership review、sanitizer/invalid handle evidence。コンパイルだけでengine受入にしない。

### EP-09 — Scheduler and roots

- **How:** `runtime/embedded/`にjobs/timers/nextTick policy、callback registry、budget/interruptを実装する。Promise内部stateをMoonBitへ複製しない。
- **What:** microtask/timer order、throw/rejection、unref、GC中callback、timer取消、infinite loop/job、host loss、root balance。
- **出口:** bounded終了とoracle traceが揃い、stress後のJS root/timer台帳が戻る。通常timerをmicrotask途中に入れて順序を偽らない。

### EP-10 — Native supervisor / transport

- **How:** 新native entryと独立QuickJS runnerをprivate channelで接続し、core authorityをnative supervisorへ置く。Node-backedの既存topologyは別laneに保持する。
- **What:** constructor/getterの同期return、UI thread非block、handshake/version、fragment/EOF/deadline、runner/host kill、同期待ち中のreentrancy。
- **出口:** Node/Node-APIなしの最小window create/query/close、owned process/FD清掃。no-Node PATHだけでは配布物のNode不在証明にしない。

### EP-15 — Snapshot / origin

- **How:** private stagingとimmutable source manifest、native document identityを0011に従い実装する。`file:`の実originと内部authorization型を分離する。
- **What:** source同時変更、symlink/escape、query/hash/non-ASCII、same-file reload vs history、opaque/inherited origin、redirect、back-forward、new/old generation。
- **出口:** 初期特権denyからnative evidenceに基づく許可へ進み、URL文字列一致だけで昇格しない。appの元working treeは不変。

## 5. S2：実アプリへつながるruntime契約

### EP-11 — CJS loader

- **How:** `runtime/modules/`と最小JS leafでwrapper/cache/resolutionを実装する。`electron` facadeはsession内単一identity、builtinsをuser packageへfallbackしない。
- **What:** cache/cycle/JSON、nested node_modules、package conditions、failed evaluation、computed require、case/symlink、stack/source map。
- **出口:** 固定source bytesのCJS/prepared JSが期待値を返す。unsupported exports/ESM/native addonをnamed errorで拒否。

### EP-12 — Node symbols and dependency adaptation

- **How:** EP-05で必要と確定したpath/url/fs/Buffer/events/process/timersとboot dependenciesだけを実装する。fs facadeのunit契約はfake brokerで先に検証し、実file権限・I/Oの完了はEP-16へ接続して判定する。
- **PR分割:** pure symbols → async/sync fs boundary → emitted boot graph → updater/zlib等の実装または明示adapter。alias・removed side effect・変わったerrorをmanifest化する。
- **What:** encoding/return/error fields、Buffer identity、top-level eager import、dev/package差、unsupported first-use。元のmacOS updater unsupported stateとfalse-successを区別する。
- **出口:** 採用boot閉包が有限で説明できる。空object stubでimportを通しただけでは不可。レンジを超えるstream/network依存が判明したら別taskへ分割してstage見積りを更新。

### EP-13 — Adapted bridge / local event API

- **How:** audited generated page-world adapterをdocument-startに設置し、許可operationだけのPromise APIとpage-local listener tableを作る。MojiのonXは同期local disposerを返し、native subscriptionの往復を必要にしない。
- **What:** adapter-install proof、固定topic、first call前の設置、ready前のbounded queue、unsubscribe/duplicate/nested emission、reloadで旧callback無効、prototype/Proxy制約。
- **出口:** DocumentIngressReadyとLoadCompleteを分けたpage-local API・installation・queueの機能契約を実証する。native sender/actual documentの安全性証明はEP-14＋EP-15の出口であり、EP-13だけでauthorityを有効化しない。native topic準備を勝手にstrict contextBridge相当と表示しない。

### EP-14 — Native ingress and IPC wiring

- **How:** native callback metadataからSenderContextを作り、EP-02のkernelへ配送する。ticket・quota・document lease・one-shot admissionをcoreで結ぶ。
- **What:** same/cross-origin iframe、srcdoc/about:blank、claimed sender、old document、replayed reply、forged outcome、load failure、早期first call、queue flood。拒否requestがhandler/file副作用を起こさない。
- **出口:** actual WKWebView→native→QuickJS Main→元documentのreplyがpositive/negative双方でPASS。synthetic metadata試験だけでは閉じない。

### EP-16 — File broker and save

- **How:** app data、readonly assets、native選択fileのFileGrantをbrokerへ実装する。open-for-edit→通常save、saveAs後の再save、再起動再許可を成立させる。
- **PR分割:** descriptor/path/race → read grants → write signatures → explicit atomic-replace mode → fault/readback。native pickerはEP-18で接続し、EP-16中はtrusted test grantで権限とI/Oを検証する。
- **What:** read-only昇格拒否、special file、permission/disk-full、metadata/hardlink、check後差替、rename前/後cancel、ACK喪失、accepted Mainがawait後に書くcase。
- **出口:** Node writeFile semanticsとadapted atomic-save差が明示され、commit pointとunknown outcomeを説明できる。普通のrenameをinode CASと誤表示しない。

### EP-17 — Lifecycle and events

- **How:** 0009のUI/CJS readiness join、window/document state、real native events、close/DOM beforeunload/quitを実装する。Mojiが使うfocus/minimize/fullscreen/normalBounds等を0014と照合する。
- **What:** readyのlistener登録順、show:false/ready-to-show、paint/load差、reentrant close、throw、cancel、multiple window、closing/crash時callback。
- **出口:** actual native operationとevent先後関係が一致し、架空paint/closedイベントがない。private transportのACKだけでは操作完了にしない。

### EP-18 — Native services

- **How:** dialogの親あり/なし・multiple selection・cancel、Menu role/responder、scoped clipboardを実装する。AppPrincipal/WindowLease/DocumentLeaseをoperationごとに使い分ける。
- **What:** 選択fileごとのgrant、readonly/save target、native menu Cmd+S/C/V/Z、dialog中focus、permission、host crash。openExternalは入力URL policyとOS handoffまでを検証する。
- **出口:** Moji初期操作に必要なservicesが実OSで完了。外部browserのredirectを追跡できると偽らず、Tray/notification/protocol等の残作業は維持。

### EP-19 — Persistence and instance lifecycle

- **How:** app/profile固有store、settings/schema、single-instance lock、second-instance/open-file policyを実装する。MojiのsetPathを踏まえdata環境を隔離する。
- **What:** 二重起動、lock owner crash、settings write failure、restart/readback、userData app override、store分離、bookmark失効。
- **出口:** HOME envだけに依存せずdata隔離を証明できる。初版はpickerによる再許可で再openし、persistent recent grantは別受入までunsupported。

### EP-20 — Native CLI

- **How:** 0013のnative doctor/inventory/run admissionを実装する。help/version/schema/exit、app/profile/source/adapterの診断を一つのentryへ揃える。
- **What:** space/日本語path、missing builtin、stale evidence、profile取り違え、no-Node launch、host crash、JSON parse、stdout protocol混線。
- **出口:** 対応profileだけが安全にrunできる。未完成機能は説明付き拒否。全appをunsupportedなく表示することを目標にしない。

## 6. S3：日常操作と故障を実証する

### EP-21 — Real application

- **How:** 0014のM1a〜M3fを固定Mojiに実行し、初回settings/listenerからguide表示、別文書編集、open、saveAs、通常save、再起動、quitまで結ぶ。
- **What:** exact app/build/adaptation hashes、file bytes、settings/bounds、dirty cancel、process/root/pendingの清掃。jmd J1はprivileged protocol拒否のnegative。
- **出口:** `App Scenario Supported (adapted)`の対象操作が一つのcandidate SHAで揃う。0001の無改修J、strict preload、export/updates全体を合格にしない。

### EP-22 — Security / fault integration

- **How:** 0010/0011の攻撃・故障をproduction pathへ注入し、native object/callback/process authorityを独立レビューする。
- **What:** denied操作の副作用0、state confusion/replay/TOCTOU、main/host/WebContent crash、long job、queue saturation、shutdown、late encode getter、resource plateau。
- **出口:** 再現するprivilege/data-loss/false-successの未解決0。reportのNOT_RUNやskippedをPASSへ正規化しない。

### EP-23 — Native interaction

- **How:** 0019のIME/focus/keyboard/basic AXを最小fixtureとMojiの双方で実行する。manualとautomationの証拠levelを分ける。
- **What:** 日本語変換確定/取消、composition中dialog/close、copy/paste、2window/別app/focus、VoiceOver、DPI/resize。
- **出口:** 初期supported environmentのrequired G casesが実機PASS。synthetic eventやAX property読取だけでphysical input/screen reader成功にしない。

## 7. S4：配布可能なpreview

### EP-24 — Pack and component audit

- **How:** immutable staging、native .app、resources、runtime/app/adapter manifest、SBOM/NOTICEを生成する。production/test targetsを分離する。
- **What:** no Node/libnode/Node-API/Electron/CEF/hidden runtime、dynamic links/spawn/PATH、source hashes、production closure、private selectors/secret混入。
- **出口:** unsigned artifactの実bytesと再現可能payloadがある。build-time Node利用と配布物Node依存を混同しない。

### EP-25 — Signing and clean install

- **How:** nested signing→notarization→staple→quarantine/Gatekeeperを実行し、Node/SDKなしmacOS arm64環境でM1〜M3を再実行する。
- **What:** wrong arch/OS、missing dependency、bundle移動、初回起動、署名破損、標準user、uninstall後data保持。
- **出口:** signed artifact hashと実install evidenceが一致する。credentials未提供なら署名未実行としてrelease gateを止め、unsigned PASSと分離する。

### EP-26 — Performance and soak

- **How:** 0017の同条件Electron/candidateを交互に測り、raw sample、全関連process、start visible/interactive、queue/rootを記録する。
- **What:** cold/warm、100,000-byte/日本語/escape-heavyとwire上限近傍、quota-negative、保存、再起動、長時間idle/edit、繰返しload/close。
- **出口:** 事前budgetとの達否を示す。小さいengine単体・空window・帰属不明processの除外で全体改善を主張しない。

### EP-27 — Preview qualification

- **How:** 0015のevidence admissionをpack artifactへ適用し、利用者向けinstall/run/data recovery/known gapsを整える。strict feasibility判定とadapted native proofを別欄へ載せる。
- **What:** 別端末で第三者が手順を再現し、evidence/source/profile/artifactが一致する。更新初版は署名済full bundleの明示入替を試験する。
- **出口:** S4の全required gateが同一candidate/artifactに揃う。公開操作はその時点のrelease指示に従い、資格判定だけで公開済みとしない。

## 8. S5：保守と適用範囲を広げる

### EP-28 — Updates and recovery

- **How:** signed metadata/download/stage/switch/first-run health/data migrationをruntime-owned updaterへ分けて実装する。
- **What:** wrong channel/epoch/hash/signature、disk full、各commit点のkill、二重起動、旧版/data schema復旧、利用者の新dataを失わないrollback。
- **出口:** 更新の失敗復旧が独立gateでPASS。Electron autoUpdater互換は別surfaceとして残す。

### EP-29 — Linux

- **How:** 0018の一つのdistro/GTK/WebKitGTK/Wayland matrix、UI loop、private transport、native frame proofを実装する。
- **What:** portable以外に実GUI、dialog/portal、IME/AT-SPI、clipboard、DPI、data/pack依存。
- **出口:** 最初の限定backend contractのPASS範囲を明記する。8–15人日は初期sliceの案であり全Moji/全distro受入の総見積りではない。残るA–Jを別作業へ見積る。

### EP-30 — Windows

- **How:** Win32/COM/WebView2のownership、message/host object、DPI、Evergreen導入状態、native private transportを実装する。
- **What:** STA/lifetime/reentrancy、frame/doc spoof、runtime不在/offline、IME/UIA、installer/sign/update。
- **出口:** 最初の限定backend契約をWindows実機で確認する。10–18人日は初期sliceのみで、全app互換・全managed環境の完了見積りではない。

### EP-31 — ESM and app/API expansion

- **How:** 0008 R4のmain ESM/import/conditions/TLA/interop、次に実需要のprotocol/session/Tray/notification/watch/native module等を個別issueに分ける。
- **What:** ESM TLAとreadyのdeadlock、module identity、preloadの別制限、jmd protocol/path/CSP、依存増分とpackサイズ。
- **出口:** 8–15人日は最初の選択した拡張sliceのみ。全一覧の対応保証ではない。app/OS/profileを一つずつ証跡で増やし、shimを増やした数を互換率にしない。

## 9. 各実装PRの共通完了条件

| 面 | review時に必要なもの |
| --- | --- |
| Why | 解決する利用者の操作/既知欠陥、対応するEPとgate |
| How | core owner、leaf境界、API/state/codec差分、production entry |
| What | positive/negative/faultの実command、対象SHA、PASS/FAIL/NOT_RUN |
| migration | manifest/wire/schema互換、旧client/旧evidenceの扱い |
| security | native sender、lifetime、bounds、data side effectの独立評価 |
| evidence | pin、raw observation、artifact digest、環境、未検証範囲 |
| user impact | 新しくできる操作、残るunsupported、必要なadaptation |
| integration | latest baseへの再適用、既存回帰、PR stackへの影響 |

全commandは既存entryか実装PRで追加したentryに限る。現時点の既存laneは `moon check --target js`、`moon test --target js`、`moon test --target native`、`npm run build`、`npm test`、macOS probe/oracle/differentialである。Node-less/native/app/pack用commandは実装時にCIとREADMEへ揃える。

## 10. 直近の着手順

1. EP-01とEP-05を並行開始し、観測欠落を通す判定と実app boot閉包のunknownを先に解消する。
2. EP-06/32でprofile・authority・配布責任を確定する。
3. EP-02とEP-03/04を別stackとして統合し、同時にEP-08を進める。共通core/protocol変更は統合担当が順序を管理する。
4. EP-07を有限spikeとして閉じ、EP-09/10/15のnative基盤を進める。
5. EP-11/12とEP-13/14を並行させ、S2では必ず同一SHAの実renderer→Main→file→replyを一本通す。

各stage末に未解決risk、変更された工数、次のcritical pathを更新する。予定日を守るためにrequired negativeや実機gateを削除しない。
