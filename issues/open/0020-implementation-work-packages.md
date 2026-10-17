# 0020: 実装作業・依存関係・PR分割・受入ゲート

Status: open
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: plan/issue-0020-work-packages

## 概要

32個の実装・調査・統合・受入作業を、依存を守って小さなPRへ分割する。各EPの入力、変更場所、観測する結果、branch案と出口を本書にまとめ、個別の詳細設計は0006〜0019、判断事項は0021へ対応付ける。

| 分類 | 内容 |
| --- | --- |
| 作業の性質 | 実装計画の親issue。32 EPは追跡単位で、32個の巨大PRを要求しない |
| 緊急性 | P0のEP-01/05から開始し、profile/authorityと両PR stackへ進む |
| 利用者への影響 | 偽成功を除き、Mojiの起動→編集→保存→再起動→配布を検証できる単位で追加する |
| 基準 | 0004のS0〜S5、0001のM0〜M4/A〜J、PR #3のN0〜N6を区別 |
| 履歴への影響 | 元PRの著者・修正履歴・依存を保持。新しいmainに対する回帰結果を別に記録 |
| 最初の着手対象 | EP-01のportable負例/判定修正とEP-05の原本/emit/boot調査 |

## 背景

現mainにはMoonBit core、Node leaf、inventory、oracle/probeがあり、nativeとIPCの後続実装は二つの未統合Draft stackに分かれている。[0005](0005-existing-work-and-integration.md) が固定HEAD・base・CI・reviewを記録する。QuickJS/profile/app選定もPR #3の設計であり、native実装やMoji受入は未完である。

[0004](0004-production-readiness-roadmap.md) は製品stage、0006〜0019は契約、[0021](0021-decisions-risks-and-maintenance.md) は判断・riskを所有する。本書はそれらを実行可能な順序へ変換する。

## 問題

関連文書をそのまま一括実装すると、main-local IPCとactual renderer sender、原本preload attestationとadapted installation、Node-backedとnative supervisor、fs facadeと実file brokerを混同しやすい。完了に必要な依存と、先に準備できるfixtureも異なる。

既存HEADのCI成功は将来の統合SHAやNode-lessの動作を保証しない。先に判定器を修正し、後続で受入する公開面・native証拠・保存結果をEPの出口として固定する必要がある。

## 目標

1. 全32 EPに直接依存・担当role・実装位置・観測する結果・分割可能な変更単位を与える。
2. EP-01/05から始め、S2でactual renderer→native→QuickJS Main→file→replyを同じSHAの一本の経路にする。
3. strict調査のNo-Goを有効な結論として記録し、adaptedの安全性は独立したgateで判定する。
4. scope・工数・契約が変わった時は、0004のstage/見積りと0021のdecision/riskを同じ変更で更新する。

## 対象外

個別EPの実装や既存PR mergeをこの文書整備で実施したとは扱わない。全EPを単一branchへ積むこと、依存未完了をfake successで置換すること、元0001の残要件を消すことは対象外である。

S5の他OS/ESM工数は最初の限定sliceの案であり、全アプリ・全distro・全Node/Electron API互換の総工数ではない。製品公開・署名credentialの取得・本体licenseの選定は各作業時に確定する。

## 提案する方針

### 1. 作業の切り方

各EPは一つの追跡単位であり、一つの巨大PRにする指示ではない。独立したcontract、実装、production wiring、negative testをreviewできる大きさに分割する。既存PRを引き継ぐ作業は、元PRの成果と修正履歴を残す。依存PRを毎回コピーして新規実装扱いにしない。

1. **着手可能**は必要な契約・fixtureが揃った状態。**完了**は対象SHAの実装、公開面、required tests、証跡、未対応表示が揃った状態。
2. tableの依存は最小の実装・統合依存。文書間の関連リンクを実行依存に変換しない。準備用のfixture/調査は先行できる。
3. `S0`〜`S5`は0004の製品stage、`M0`〜`M4`は0001、`N0`〜`N6`はPR #3のgate。0008の`R1`〜`R4`はengine/loader内の実装順であり、製品stageとは別である。
4. 予定pathは既存fileを除き未作成。実装PRが最終package構成・command名を決める。空package、空stub、fake successを作っただけでは完了しない。
5. 担当は必要な役割の提案であり、特定の人を割り当て済みとはしない。security/data-loss/false-successのレビューは実装者以外が担当する。

### 作業台帳と変更の契約

将来の機械可読backlogは `compatibility/work-packages.json` を配置案とする。まだ存在しないため、本表が当面の正本である。採用する場合の1行は `id`、`sourceIssue`、`kind`、`priority`、`dependsOn`、`stage`、`ownerRole`、`branch`、`acceptanceIds`、`evidenceRefs`、`estimateDays:{min,max}` を持ち、準備状態と実装完了を別fieldで表す。担当者不明はnullとし、roleから人名を生成しない。

各EPは、入力契約/fixtureのPR、実装PR、actual backendの結合PRへ必要な範囲で分ける。branch案は未作成で、既存PRを更新する場合はその履歴と参照を維持する。依存表の変更は理由・影響するgate・増減工数を変更履歴へ残す。新wire/profileの互換性判断は0006/0010、機械可読台帳のreaderと旧IDの扱いは0015の証跡方針へ揃える。

### 2. 実行依存の一覧

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

### 3. S0：誤成功の排除と入力固定

#### EP-01 — Evidence admission
- **種別 / 優先度 / branch案:** 不具合修正 / 統合 / P0 / `fix/ep-01-evidence-admission`。


- **How:** PR #8を既存baseline validatorへ統合し、PR #6に残るmissing observations、DOM clipboard opt-in、NSNull shapeの判定を修正する。`scripts/`、`tests/macos-probe-validation.test.cjs`、macOS probe、report schemaが対象。
- **PR分割:** baseline semantic admission → missing/null validator negative → clipboard side-effect gateとnative malformed input。実機変更とportable validatorを混ぜて一つのPASSにしない。
- **What:** observed欠損、null、wrong type、wrong oracle/hash、synthetic candidate、timeoutでcompatibleへ昇格しない。opt-inなしで一般clipboard変更0。詳細は0005/0015。
- **出口:** 対象main SHAと各負例が一致し、mainに残る既知欠陥を閉じた証拠がある。既存テストだけのPASSでは不可。

#### EP-05 — App input / boot oracle
- **種別 / 優先度 / branch案:** 調査 / 再現fixture / P0 / `research/ep-05-app-boot`。


- **How:** `compatibility/apps/`、`fixtures/apps/`へimmutable app registry、fetch/build manifest、symbol/dependency closureを追加する。Moji v1.0.5とjmd v0.2.3のoriginal/prepared/adapter hashesを分ける。
- **PR分割:** 原本/lock inventory → locked build/typecheck → emitted module inventory → upstream起動・first-use baseline。
- **What:** Moji eager updater/zlib/Buffer、初回getSettings/getUpdateState/onX、userData overrideを漏らさない。jmd privileged protocol要求をnegativeとして固定する。
- **出口:** source読取だけでなく実際のbuild出力と起動traceがある。updaterを維持実装するか明示adaptationするかをADRで決め、起動閉包がunknownのままS2の必要shimを確定しない。

#### EP-06 — Profile and authority contract
- **種別 / 優先度 / branch案:** ADR / schema実装 / P0 / `feat/ep-06-profile-authority`。


- **How:** 0006のprofileとnative MoonBit authority正本をADR/manifest schemaへ反映する。0007 B1のdirect-sender/authorized-parent relayを区別するADRとpinned oracleを必須成果物にする。これはstrict spikeとadapted双方で共有する。既存Node-backedとの共存範囲を明示して`AGENTS.md`の実装適用範囲を整える。今回の文書追加だけで既存instructionを書き換え済みとはしない。
- **PR分割:** ADR/profile schema → admission/diagnostics → internal ownership types。
- **What:** inputMode、preloadMode、dependency/behavior adaptations、runtime engine、evidence profileの交差組合せ。TS+generated adapterを同時に表現し、Node版証拠をstrictへ転用できない。
- **出口:** IDs/grants/request terminalの唯一のowner、Main/AppPrincipalとrenderer/DocumentLeaseの違い、native leaf境界がレビュー済み。既存通常run/packのgateは維持。

#### EP-32 — License and maintenance ownership
- **種別 / 優先度 / branch案:** 配布方針 / 保守台帳実装 / P0 / `docs/ep-32-license-maintenance`。


- **How:** 0021のcomponent/update matrix、root licenseの所有者判断、NOTICE/SBOMの入力を追加する。QuickJS/app rootのMITをproject licenseへ流用しない。
- **What:** 実bundle componentの由来、license obligations、upstream pin更新時の再試験範囲、security報告から修正版までの担当roleが追跡できる。
- **出口:** 配布に必要なlicense方針と依存台帳が確定し、未決のままEP-24/25をrelease-readyにしない。継続保守そのものを一度のPRで完了扱いにしない。

### 4. S1：既存成果の統合とnative/engine基盤

#### EP-02 — IPC core stack
- **種別 / 優先度 / branch案:** 既存PR統合 / P0 / `integrate/ep-02-ipc-core`。


- **How:** #9 → #11 → #12の順で最新統合baseへ載せる。`core/`、Node leaf、facade、codec、oracle fixtureを再利用する。
- **What:** duplicate listeners、most-recent remove、nested once、handleOnce admission、captured handler、undefined、revoked result、thenable/getter、boundsを維持。
- **出口:** JS/native coreとNode leafが同SHAでPASS。16 scenarioのsynthetic candidateという証拠範囲を保持し、renderer E2E完成としない。

#### EP-03 — Native host integration
- **種別 / 優先度 / branch案:** 既存PR統合 / P0 / `integrate/ep-03-native-host`。


- **How:** #2のmain競合を別checkoutで解消し、#4のdata/ready/quit/JSON修正と#7のtoolchain pinを保つ。`platform/macos/`、private transport、core dispatch、host testが対象。
- **What:** actual native ACK、window geometry、same-file reload、old WKNavigation拒否、cancel、FD/child rollback。レビューthread34件のうちoutdated未解決23件を根拠付きtriageする。
- **出口:** 新mainとの統合SHAでportable/Node/macOS/faultを再実行し、競合箇所と保持したbehaviorをレビューできる。古いHEADのCIを代用しない。

#### EP-04 — Bootstrap and attestation
- **種別 / 優先度 / branch案:** 既存PR統合 / P0 / `integrate/ep-04-attestation`。


- **How:** #10 → #13をEP-03へ順に統合する。isolated handler exposure、one-shot native event、status readbackの契約を保つ。
- **What:** failed/caught-unsupported preloadがattestされない、one-shot、reload/host loss、attestation/load laneの逆順と旧generation。
- **出口:** PR #13のoriginal-preload proofとして接続済み。adapted adapter-install proofと任意page senderの証明は別作業に残す。

#### EP-07 — Strict feasibility decision
- **種別 / 優先度 / branch案:** 有限feasibility調査 / P0 / `research/ep-07-strict-bridge`。


- **How:** 0007の **B5 strict public primitive spike** とfeasibility evidenceを有限の実験計画へ落とす。B1のsender ADRはEP-06を使う。公開WebKit API、native frame/world、realm/proxy/callback/同期return、page first-script、DOM spoofを同一fixtureで調べる。B3/B4のadapted実装はEP-13/14、B6/B7のstrict製品shim/verificationはGo後の別作業へ分ける。
- **What:** Main sync RPCの成功をcross-world sync proofにしない。parentが意図的にrelayするケースのElectron参照結果と、direct child forgeryを別記録する。
- **出口:** Goなら全required fixtureと公開APIの実証、No-Goなら失敗する最小case・残る仮説・再開triggerが揃う。timebox案は7–10人日。時間満了をGoにせず、新たな根拠なしで同じspikeを無限反復しない。

#### EP-08 — QuickJS C ABI
- **種別 / 優先度 / branch案:** native FFI実装 / P1 / `feat/ep-08-quickjs-abi`。


- **How:** `vendor/quickjs/lock.json`、`bridges/embedded-js/`、MoonBit native FFIを追加し、2026-06-04 source/build hashを検証する。任意QuickJS bytecodeを入力として受け付けない。
- **What:** eval/return/throw/string/buffer、所有権transfer、borrowed値の保持拒否、partial-create cleanup、非所有threadからのcall拒否。
- **出口:** native実行、C ABI ownership review、sanitizer/invalid handle evidence。コンパイルだけでengine受入にしない。

#### EP-09 — Scheduler and roots
- **種別 / 優先度 / branch案:** scheduler実装 / P1 / `feat/ep-09-engine-jobs`。


- **How:** `runtime/embedded/`にjobs/timers/nextTick policy、callback registry、budget/interruptを実装する。Promise内部stateをMoonBitへ複製しない。
- **What:** microtask/timer order、throw/rejection、unref、GC中callback、timer取消、infinite loop/job、host loss、root balance。
- **出口:** bounded終了とoracle traceが揃い、stress後のJS root/timer台帳が戻る。通常timerをmicrotask途中に入れて順序を偽らない。

#### EP-10 — Native supervisor / transport
- **種別 / 優先度 / branch案:** native統合実装 / P0 / `feat/ep-10-native-supervisor`。


- **How:** 新native entryと独立QuickJS runnerをprivate channelで接続し、core authorityをnative supervisorへ置く。Node-backedの既存topologyは別laneに保持する。
- **What:** constructor/getterの同期return、UI thread非block、handshake/version、fragment/EOF/deadline、runner/host kill、同期待ち中のreentrancy。
- **出口:** Node/Node-APIなしの最小window create/query/close、owned process/FD清掃。no-Node PATHだけでは配布物のNode不在証明にしない。

#### EP-15 — Snapshot / origin
- **種別 / 優先度 / branch案:** snapshot / authority実装 / P0 / `feat/ep-15-snapshot-origin`。


- **How:** private stagingとimmutable source manifest、native document identityを0011に従い実装する。`file:`の実originと内部authorization型を分離する。
- **What:** source同時変更、symlink/escape、query/hash/non-ASCII、same-file reload vs history、opaque/inherited origin、redirect、back-forward、new/old generation。
- **出口:** 初期特権denyからnative evidenceに基づく許可へ進み、URL文字列一致だけで昇格しない。appの元working treeは不変。

### 5. S2：実アプリへつながるruntime契約

#### EP-11 — CJS loader
- **種別 / 優先度 / branch案:** module loader実装 / P1 / `feat/ep-11-cjs-loader`。


- **How:** `runtime/modules/`と最小JS leafでwrapper/cache/resolutionを実装する。`electron` facadeはsession内単一identity、builtinsをuser packageへfallbackしない。
- **What:** cache/cycle/JSON、nested node_modules、package conditions、failed evaluation、computed require、case/symlink、stack/source map。
- **出口:** 固定source bytesのCJS/prepared JSが期待値を返す。unsupported exports/ESM/native addonをnamed errorで拒否。

#### EP-12 — Node symbols and dependency adaptation
- **種別 / 優先度 / branch案:** API subset / adaptation実装 / P1 / `feat/ep-12-node-symbols`。


- **How:** EP-05で必要と確定したpath/url/fs/Buffer/events/process/timersとboot dependenciesだけを実装する。fs facadeのunit契約はfake brokerで先に検証し、実file権限・I/Oの完了はEP-16へ接続して判定する。
- **PR分割:** pure symbols → async/sync fs boundary → emitted boot graph → updater/zlib等の実装または明示adapter。alias・removed side effect・変わったerrorをmanifest化する。
- **What:** encoding/return/error fields、Buffer identity、top-level eager import、dev/package差、unsupported first-use。元のmacOS updater unsupported stateとfalse-successを区別する。
- **出口:** 採用boot閉包が有限で説明できる。空object stubでimportを通しただけでは不可。レンジを超えるstream/network依存が判明したら別taskへ分割してstage見積りを更新。

#### EP-13 — Adapted bridge / local event API
- **種別 / 優先度 / branch案:** page API実装 / P0 / `feat/ep-13-adapted-api`。


- **How:** audited generated page-world adapterをdocument-startに設置し、許可operationだけのPromise APIとpage-local listener tableを作る。MojiのonXは同期local disposerを返し、native subscriptionの往復を必要にしない。
- **What:** adapter-install proof、固定topic、first call前の設置、ready前のbounded queue、unsubscribe/duplicate/nested emission、reloadで旧callback無効、prototype/Proxy制約。
- **出口:** DocumentIngressReadyとLoadCompleteを分けたpage-local API・installation・queueの機能契約を実証する。native sender/actual documentの安全性証明はEP-14＋EP-15の出口であり、EP-13だけでauthorityを有効化しない。native topic準備を勝手にstrict contextBridge相当と表示しない。

#### EP-14 — Native ingress and IPC wiring
- **種別 / 優先度 / branch案:** production ingress実装 / P0 / `feat/ep-14-native-ingress`。


- **How:** native callback metadataからSenderContextを作り、EP-02のkernelへ配送する。ticket・quota・document lease・one-shot admissionをcoreで結ぶ。
- **What:** same/cross-origin iframe、srcdoc/about:blank、claimed sender、old document、replayed reply、forged outcome、load failure、早期first call、queue flood。拒否requestがhandler/file副作用を起こさない。
- **出口:** actual WKWebView→native→QuickJS Main→元documentのreplyがpositive/negative双方でPASS。synthetic metadata試験だけでは閉じない。

#### EP-16 — File broker and save
- **種別 / 優先度 / branch案:** file broker実装 / P0 / `feat/ep-16-file-broker`。


- **How:** app data、readonly assets、native選択fileのFileGrantをbrokerへ実装する。open-for-edit→通常save、saveAs後の再save、再起動再許可を成立させる。
- **PR分割:** descriptor/path/race → read grants → write signatures → explicit atomic-replace mode → fault/readback。native pickerはEP-18で接続し、EP-16中はtrusted test grantで権限とI/Oを検証する。
- **What:** read-only昇格拒否、special file、permission/disk-full、metadata/hardlink、check後差替、rename前/後cancel、ACK喪失、accepted Mainがawait後に書くcase。
- **出口:** Node writeFile semanticsとadapted atomic-save差が明示され、commit pointとunknown outcomeを説明できる。普通のrenameをinode CASと誤表示しない。

#### EP-17 — Lifecycle and events
- **種別 / 優先度 / branch案:** lifecycle実装 / P1 / `feat/ep-17-lifecycle`。


- **How:** 0009のUI/CJS readiness join、window/document state、real native events、close/DOM beforeunload/quitを実装する。Mojiが使うfocus/minimize/fullscreen/normalBounds等を0014と照合する。
- **What:** readyのlistener登録順、show:false/ready-to-show、paint/load差、reentrant close、throw、cancel、multiple window、closing/crash時callback。
- **出口:** actual native operationとevent先後関係が一致し、架空paint/closedイベントがない。private transportのACKだけでは操作完了にしない。

#### EP-18 — Native services
- **種別 / 優先度 / branch案:** native services実装 / P1 / `feat/ep-18-desktop-services`。


- **How:** dialogの親あり/なし・multiple selection・cancel、Menu role/responder、scoped clipboardを実装する。AppPrincipal/WindowLease/DocumentLeaseをoperationごとに使い分ける。
- **What:** 選択fileごとのgrant、readonly/save target、native menu Cmd+S/C/V/Z、dialog中focus、permission、host crash。openExternalは入力URL policyとOS handoffまでを検証する。
- **出口:** Moji初期操作に必要なservicesが実OSで完了。外部browserのredirectを追跡できると偽らず、Tray/notification/protocol等の残作業は維持。

#### EP-19 — Persistence and instance lifecycle
- **種別 / 優先度 / branch案:** storage / instance実装 / P1 / `feat/ep-19-persistence`。


- **How:** app/profile固有store、settings/schema、single-instance lock、second-instance/open-file policyを実装する。MojiのsetPathを踏まえdata環境を隔離する。
- **What:** 二重起動、lock owner crash、settings write failure、restart/readback、userData app override、store分離、bookmark失効。
- **出口:** HOME envだけに依存せずdata隔離を証明できる。初版はpickerによる再許可で再openし、persistent recent grantは別受入までunsupported。

#### EP-20 — Native CLI
- **種別 / 優先度 / branch案:** CLI実装 / P1 / `feat/ep-20-native-cli`。


- **How:** 0013のnative doctor/inventory/run admissionを実装する。help/version/schema/exit、app/profile/source/adapterの診断を一つのentryへ揃える。
- **What:** space/日本語path、missing builtin、stale evidence、profile取り違え、no-Node launch、host crash、JSON parse、stdout protocol混線。
- **出口:** 対応profileだけが安全にrunできる。未完成機能は説明付き拒否。全appをunsupportedなく表示することを目標にしない。

### 6. S3：日常操作と故障を実証する

#### EP-21 — Real application
- **種別 / 優先度 / branch案:** 実アプリ結合受入 / P1 / `test/ep-21-moji-scenarios`。


- **How:** 0014のM1a〜M3fを固定Mojiに実行し、初回settings/listenerからguide表示、別文書編集、open、saveAs、通常save、再起動、quitまで結ぶ。
- **What:** exact app/build/adaptation hashes、file bytes、settings/bounds、dirty cancel、process/root/pendingの清掃。jmd J1はprivileged protocol拒否のnegative。
- **出口:** `App Scenario Supported (adapted)`の対象操作が一つのcandidate SHAで揃う。0001の無改修J、strict preload、export/updates全体を合格にしない。

#### EP-22 — Security / fault integration
- **種別 / 優先度 / branch案:** 独立security / fault検証 / P0 / `test/ep-22-security-fault`。


- **How:** 0010/0011の攻撃・故障をproduction pathへ注入し、native object/callback/process authorityを独立レビューする。
- **What:** denied操作の副作用0、state confusion/replay/TOCTOU、main/host/WebContent crash、long job、queue saturation、shutdown、late encode getter、resource plateau。
- **出口:** 再現するprivilege/data-loss/false-successの未解決0。reportのNOT_RUNやskippedをPASSへ正規化しない。

#### EP-23 — Native interaction
- **種別 / 優先度 / branch案:** 実機操作受入 / P1 / `test/ep-23-native-interaction`。


- **How:** 0019のIME/focus/keyboard/basic AXを最小fixtureとMojiの双方で実行する。manualとautomationの証拠levelを分ける。
- **What:** 日本語変換確定/取消、composition中dialog/close、copy/paste、2window/別app/focus、VoiceOver、DPI/resize。
- **出口:** 初期supported environmentのrequired G casesが実機PASS。synthetic eventやAX property読取だけでphysical input/screen reader成功にしない。

### 7. S4：配布可能なpreview

#### EP-24 — Pack and component audit
- **種別 / 優先度 / branch案:** pack / component実装 / P1 / `feat/ep-24-native-pack`。


- **How:** immutable staging、native .app、resources、runtime/app/adapter manifest、SBOM/NOTICEを生成する。production/test targetsを分離する。
- **What:** no Node/libnode/Node-API/Electron/CEF/hidden runtime、dynamic links/spawn/PATH、source hashes、production closure、private selectors/secret混入。
- **出口:** unsigned artifactの実bytesと再現可能payloadがある。build-time Node利用と配布物Node依存を混同しない。

#### EP-25 — Signing and clean install
- **種別 / 優先度 / branch案:** 署名 / clean install検証 / P1 / `release/ep-25-clean-install`。


- **How:** nested signing→notarization→staple→quarantine/Gatekeeperを実行し、Node/SDKなしmacOS arm64環境でM1〜M3を再実行する。
- **What:** wrong arch/OS、missing dependency、bundle移動、初回起動、署名破損、標準user、uninstall後data保持。
- **出口:** signed artifact hashと実install evidenceが一致する。credentials未提供なら署名未実行としてrelease gateを止め、unsigned PASSと分離する。

#### EP-26 — Performance and soak
- **種別 / 優先度 / branch案:** 性能測定 / soak検証 / P1 / `test/ep-26-performance`。


- **How:** 0017の同条件Electron/candidateを交互に測り、raw sample、全関連process、start visible/interactive、queue/rootを記録する。
- **What:** cold/warm、100,000-byte/日本語/escape-heavyとwire上限近傍、quota-negative、保存、再起動、長時間idle/edit、繰返しload/close。
- **出口:** 事前budgetとの達否を示す。小さいengine単体・空window・帰属不明processの除外で全体改善を主張しない。

#### EP-27 — Preview qualification
- **種別 / 優先度 / branch案:** preview資格レビュー / 手順 / P1 / `release/ep-27-preview-qualification`。


- **How:** 0015のevidence admissionをpack artifactへ適用し、利用者向けinstall/run/data recovery/known gapsを整える。strict feasibility判定とadapted native proofを別欄へ載せる。
- **What:** 別端末で第三者が手順を再現し、evidence/source/profile/artifactが一致する。更新初版は署名済full bundleの明示入替を試験する。
- **出口:** S4の全required gateが同一candidate/artifactに揃う。公開操作はその時点のrelease指示に従い、資格判定だけで公開済みとしない。

### 8. S5：保守と適用範囲を広げる

#### EP-28 — Updates and recovery
- **種別 / 優先度 / branch案:** 更新 / 復旧実装 / P2 / `feat/ep-28-update-recovery`。


- **How:** signed metadata/download/stage/switch/first-run health/data migrationをruntime-owned updaterへ分けて実装する。
- **What:** wrong channel/epoch/hash/signature、disk full、各commit点のkill、二重起動、旧版/data schema復旧、利用者の新dataを失わないrollback。
- **出口:** 更新の失敗復旧が独立gateでPASS。Electron autoUpdater互換は別surfaceとして残す。

#### EP-29 — Linux
- **種別 / 優先度 / branch案:** Linux限定backend実装 / P2 / `feat/ep-29-linux-backend`。


- **How:** 0018の一つのdistro/GTK/WebKitGTK/Wayland matrix、UI loop、private transport、native frame proofを実装する。
- **What:** portable以外に実GUI、dialog/portal、IME/AT-SPI、clipboard、DPI、data/pack依存。
- **出口:** 最初の限定backend contractのPASS範囲を明記する。8–15人日は初期sliceの案であり全Moji/全distro受入の総見積りではない。残るA–Jを別作業へ見積る。

#### EP-30 — Windows
- **種別 / 優先度 / branch案:** Windows限定backend実装 / P2 / `feat/ep-30-windows-backend`。


- **How:** Win32/COM/WebView2のownership、message/host object、DPI、Evergreen導入状態、native private transportを実装する。
- **What:** STA/lifetime/reentrancy、frame/doc spoof、runtime不在/offline、IME/UIA、installer/sign/update。
- **出口:** 最初の限定backend契約をWindows実機で確認する。10–18人日は初期sliceのみで、全app互換・全managed環境の完了見積りではない。

#### EP-31 — ESM and app/API expansion
- **種別 / 優先度 / branch案:** 選択したAPI拡張実装 / P2 / `feat/ep-31-module-expansion`。


- **How:** 0008 R4のmain ESM/import/conditions/TLA/interop、次に実需要のprotocol/session/Tray/notification/watch/native module等を個別issueに分ける。
- **What:** ESM TLAとreadyのdeadlock、module identity、preloadの別制限、jmd protocol/path/CSP、依存増分とpackサイズ。
- **出口:** 8–15人日は最初の選択した拡張sliceのみ。全一覧の対応保証ではない。app/OS/profileを一つずつ証跡で増やし、shimを増やした数を互換率にしない。

### 10. 直近の着手順

1. EP-01とEP-05を並行開始し、観測欠落を通す判定と実app boot閉包のunknownを先に解消する。
2. EP-06/32でprofile・authority・配布責任を確定する。
3. EP-02とEP-03/04を別stackとして統合し、同時にEP-08を進める。共通core/protocol変更は統合担当が順序を管理する。
4. EP-07を有限spikeとして閉じ、EP-09/10/15のnative基盤を進める。
5. EP-11/12とEP-13/14を並行させ、S2では必ず同一SHAの実renderer→Main→file→replyを一本通す。

各stage末に未解決risk、変更された工数、次のcritical pathを更新する。予定日を守るためにrequired negativeや実機gateを削除しない。

## 受け入れ条件

### 9. 各実装PRの共通完了条件

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

- [ ] Given 全EPの直接依存表、when実装順を評価する、thenIDは一意で参照先が存在し、自己依存/循環がなく、準備作業の先行を製品出口の完了と混同しない。
- [ ] Given EP-01/05の入力、when最初のPRを切る、then本書と0005/0014だけから変更するファイル・期待する負例/trace・残る依存を特定できる。
- [ ] Given strict spikeがNo-Go、when EP-07の出口を審査する、then最小反証と再開条件を伴えば調査完了にできる。EP-27はその決定を要求するがstrict Goを要求しない。
- [ ] Given EP-13のpage API fixtureがPASS、when EP-14の完了を判断する、thenEP-15のsnapshot/actual documentとnative sender証拠が欠ければproduction authorityは有効化しない。
- [ ] Given EP-12のfs facadeがfake brokerでPASS、when EP-16/19/21を判定する、then実file権限・bytes・通常save・再保存・再起動の証拠が独立して必須になる。
- [ ] Given 元PRまたは元acceptanceを引き継ぐ変更、when新mainへ統合する、then変更履歴・元要求・対象SHAが追跡でき、同一SHAのrequired回帰が記録される。
- [ ] Given 全G0〜G4の出口、whenpreview資格を審査する、then0015のsame-source/profile/artifact条件と0016の配布条件を満たし、未実行のnative/app操作を完了に数えない。

## テスト計画

### 計画の検証

共通issue CLIの `validate --issue-root issues` を repository-root 指定で実行し、metadata/section/pathを検査する。次にID一意性、依存先存在、循環、全32EPの本文、全リンクを確認する。基準の直接依存は74本、S0〜S4の28件は135〜235人日。scope変更時は数値を維持するために行を削らず、0004と共に再計算する。

| 照合する関係 | 検証する条件 |
| --- | --- |
| EP-14 / EP-15 | native ingressがsource/origin/actual documentへ依存する |
| EP-19 / EP-16 | persistenceの完了前にfile保存/権限の実装が必要 |
| EP-24 / EP-32 | packのrelease readinessがlicense/同梱物条件へ依存する |
| B1〜B7 / EP | B1はEP-06、B2はEP-04、adapted B3/B4はEP-13/14/15、B5はEP-07、strict B6/B7はGo後の別見積り |
| N1a / EP-08/09/11 | FFI/jobsだけでCJS cache/cycle/identityの要件を閉じない |

### 各EP実装時の検証

既存commandsは§9のとおり。最初のEP-01は `node --test tests/macos-probe-validation.test.cjs tests/manifest.test.cjs` に0005の欠損/null/不正baselineの回帰を加える。#8の取り込み後はそのbaseline負例も同じ対象SHAで実行する。既存testsがPASSしても既知のobserved欠落の再現が残れば未完とする。

その後の実装は各EPのWhatを単体・結合・fault・manualの適切な方法に落とし、実装したharnessのcommandと期待値をPRへ記録する。未作成のNode-less/app/pack commandを現在実行可能なentryとして掲載しない。MoonBitなし、非macOS、署名環境なしの場合は対象laneをNOT RUNとして分け、portable結果だけでnative出口を閉じない。

## リスク

- 既存stack統合で古いcoreや#4/#7の挙動を復活・消失させる危険がある。EP-02/03の差分と同一SHAの回帰を入口にする。
- native identity、同期性、file保存は偽実装でも表面的な操作が通る。EP-07/14/16/22の負例と実backendを必須にする。
- EP-05の依存調査で初期8〜15人日のshim範囲を超える可能性がある。新scopeを別作業へ分けて再見積りする。
- owner roleは担当確保ではなく、人日案は納期保証ではない。0021のdecision台帳に未決の担当・実機・配布条件を残す。
- 機械可読backlogを導入する場合、Markdownとの二重正本が新たな矛盾を作り得る。生成元を一つに決め、検証なしの手動二重更新を要求しない。

## 未解決の質問

実行順序そのものは本書で確定した提案として使用できる。下記は依存する作業の範囲や安全条件を確定する質問である。

| 質問 | 対応EP / role | 再開条件 |
| --- | --- | --- |
| 原本Mojiの実build/boot閉包と必要なadaptationは何か | EP-05/12、App / Engine | source・emit・動的trace・差分manifestを固定。調査EP-05自体は今すぐ着手可 |
| Node-lessと原Node-backedのinstruction/profile/authorityをどこで分けるか | EP-06、Maintainer / Core / Security | DEC-01/03のADRと検証可能なschemaを採用後、新profile実装へ進む |
| first-call前後のactual document proofが実public APIで成立するか | EP-13/14/15、Native / Security | 早期RPC・load-blocking・iframe/reload負例の実機証拠でproduction接続を再開 |
| 本体license・署名・実機・budget・保守担当は何か | EP-23〜27/32、Maintainer / Release / QA | DEC-08〜11を該当gate前に確定。component棚卸しと測定準備は先行可 |

各質問の保留対象は該当EPの製品出口であり、全32件の作業開始を一括で止めるものではない。

## 変更履歴

- 2026-10-17: 32 EPと74直接依存、PR分割、stage、工数の初期計画を追加。
- 2026-10-17: polish-issueで全EPに種別・優先度・branch案を追加し、先行着手と依存後の製品出口、共通受入・検証・未解決判断を明文化。元の全EPと依存・工数を保持。

## 注記

**準備状態:** EP-01とEP-05の最初のsliceは着手可。他EPは直接依存が揃い、該当するDECの前提を確定した範囲で着手する。調査結果の不確実性と調査計画の実行可能性を区別する。

**状態と配置:** 既存の状態ディレクトリは `issues/open` のみで、今回も指定された配置と `open` を維持する。これは着手不可や実装済みという表示ではない。本文の着手条件・未解決事項と、実装後の受入を別々に判定する。未解決事項による保留前の状態・復帰先はいずれも `open`、復帰先パスは本ファイル。新しい状態は追加しない。

`Branch` は次の作業用ブランチ案であり、作成済みではない。既存 PR を引き継ぐときは元の履歴を保ち、同内容を別実装として数えない。今回の変更は本文整備であり、既存 PR の merge、runtime の有効化、license 選択、release の実行を意味しない。

整備基準は指定された [polish-issue](https://github.com/f4ah6o/skills/blob/0f6bc769ccce0ce03c6db0457f6a0c2c8ccd3878/skills/polish-issue/SKILL.md)。確認した最新 main は [`8177cf0`](https://github.com/f4ah6o/electron.mbt/commit/8177cf051976b8d7b9eca25ae7ad8820bb04a719)。それ以前の source/PR/CI の固定 SHA は歴史的根拠として維持し、新 SHA の実行結果へ転記しない。

**参照:** [0004 roadmap](0004-production-readiness-roadmap.md)、[0005固定PR台帳](0005-existing-work-and-integration.md)、[0006 architecture](0006-runtime-architecture-and-profiles.md)、[0007 bridge](0007-context-bridge-feasibility-and-security.md)、[0008 engine](0008-nodeless-runtime-and-module-loader.md)、[0011 file](0011-app-loading-origin-and-storage.md)、[0014 app](0014-real-app-acceptance.md)、[0015 evidence](0015-oracle-ci-and-evidence.md)、[0021 decisions](0021-decisions-risks-and-maintenance.md)。
