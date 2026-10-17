# 0021: 設計決定・実用化リスク・変更管理と保守ポリシー

Status: open
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: docs/issue-0021-decisions-maintenance

## 概要

profile・native所有権・bridge・保存・証拠・配布・保守に関する決定を、根拠と適用範囲を保持した台帳へ落とす。ADR-P01〜P16、R01〜R21、DEC-01〜DEC-11を安定IDとして管理し、必要な判断が未確定のまま実装・release gateを通さない。

| 分類 | 内容 |
| --- | --- |
| 作業の性質 | 調査・設計・運用文書と判定schemaの実装。継続保守全体を1PRで完了にしない |
| 優先度 | P0: 誤成功、authority、file data、配布物の根拠。P1/P2はrisk registerで区別 |
| 利用者への影響 | 対応scope、欠陥時の停止・復旧、更新責任、配布条件が明示される |
| 初期担当 | Repository maintainerがowner roleと実担当を対応付ける。未割当は未割当と記録 |
| 影響範囲 | EP-06/32と全製品gate。予定のADR・decision/risk/component台帳・SECURITY/保守文書 |
| 履歴への影響 | 旧ADR/raw evidence/PRを消さず、採用・変更・停止の理由を追加する |

## 背景

### 1. この台帳の使い方

既存の決定を保存し、未実装の提案と実測した結果を分けて変更する。main の正本は [Issue 0001](0001-electron-compatible-lightweight-runtime.md) と [AGENTS.md][R-AGENTS] であり、PR #3 の ADR は Draft PR 内の `accepted-for-design` である。今回の計画を追加しても PR の取り込み、実装成功、互換 gate の通過を意味しない。[R-ADR]

| 台帳上の状態 | 意味 | 状態を変えるための根拠 |
| --- | --- | --- |
| F: snapshot 確認事実 | main / PR HEAD / source / report の範囲を明記し、固定 SHA の内容を確認 | 新 SHA と対応する読取・実行結果。PR の確認を main 実装へ転記しない。 |
| D: 既存 Draft 設計 | 既存 PR で選定・提案済み、main 未反映 | PR の採用判断と新しい契約・実装差分 |
| P: 今回の提案 | 実装者が review する具体方針 | owner、契約、負例、受入 gate を固定した実装 PR |
| verified | 特定 profile / source / OS / fixture で実証 | 0015 の有効な証跡。設計への賛成や CI green だけでは不可 |
| blocked / no-go | 必須根拠が欠ける、または対象方式が受入不成立 | 不足条件または反証を解消した新しい証跡 |

本書の `ADR-Pxx` は `plan:0021` 内の安定 ID とする。既存 `docs/adr/0001-nodeless-macos-runtime-decisions.md` を改名・上書きせず、実装時の独立 ADR はこの ID と元 ADR を参照する。旧 `0002` の重複は [0005](0005-existing-work-and-integration.md) の alias を用いる。PR は `PR:2` のように表し、文書番号と混同しない。

製品 stage は 0004 の **S0〜S5** を用いる。Issue 0001 の M0〜M4、PR #3 の N0〜N6、0008 の R1〜R4 はそれぞれ元の意味で保存する。M0 が blocked であることと、独立した adapted profile の作業が進められることは、別々の状態として管理する。

## 問題

mainのM0 partial、未mergeのDraft設計、今回の提案、将来のverifiedが同時に存在する。これらを一つの「決定済み」「完了」にまとめると、選定したengineや成功したCIを製品成立の根拠として誤用してしまう。

既知の観測欠損受理と未統合stackはR01〜R06に、予防する権限・data・供給・運用上のriskはR07〜R21に分ける。root LICENSE、署名主体、private報告先、実機や保守担当は未確定であり、他componentのlicenseやrole名から決定済みと推定できない。

## 目標

1. 事実の出所、設計上の採用、実行証拠による受入を独立して表す。
2. 各blocking decisionに影響するEP・owner・必要な材料・再開条件を与え、先行できる調査を明示する。
3. profile/wire/evidence/data/OSのversion変更時に、旧証拠と互換性・復旧方法を追跡できるようにする。
4. actual artifactのcomponentと更新責任を照合し、署名済previewを維持できる条件を整える。

## 対象外

本体licenseを本文だけで選定すること、未設定の窓口/SLAを公開済みとすること、担当者を推測して割り当てること、credentialを取得・公開することは対象外である。security incidentが観測されていないriskを実事故として報告しない。

engine再選定、アプリの置換、元0001のscope縮小は別ADRの対象。required native/evidence/data gateをowner判断だけで免除する運用は導入しない。

## 提案する方針

### 最初のPRと予定の変更場所

最初のPRは台帳schema・既存snapshotの移記・負例を対象とする。現在存在する `compatibility/manifest.json`、`moon.mod`、`package.json`、`.github/workflows/ci.yml` と0005の固定PR sourceを読み、runtime component・pin・roleの未確定欄を収集する。本体licenseの選択や実署名が未決でも、この棚卸しは着手できる。

| 配置案（未作成） | 内容 / 入出力 |
| --- | --- |
| `compatibility/decisions.json` | ADR-Pxx/DEC-xx、source class、適用profile/EP、採用状態、根拠、owner、判断期限と再開条件 |
| `compatibility/risks.json` | Rxx、observed/potentialの区別、trigger、停止scope、mitigation、fix SHA、regression evidence、residual risk |
| `compatibility/components.json` | component pin/由来/取得hash/license根拠/build-onlyまたはruntime/更新担当。actual bundleとの照合は0016 |
| `docs/adr/` | 採用した決定と代替案・互換/移行・why not。既存Draft ADRを履歴なしに上書きしない |
| `docs/maintenance.md` / `SECURITY.md` | owner・代替手順・supported versions・実在する報告先。未確定の連絡先を埋めない |
| `scripts/validate-governance.cjs` / `tests/governance.test.cjs` | 台帳ID/参照/必須条件・状態遷移を検査し、判定不能を成功にしない。commandは実装時に追加 |

実装PRで正本をJSONにするかMarkdownにするかを一つに固定し、他方は生成または検証付きviewにする。最初から双方向の手動同期を必須にしない。PR #3の既存ADR名はaliasを保持し、新規ADRから元SHAへ参照する。

### 台帳のデータ契約案

- `sourceClass` は `snapshot-fact` / `draft-design` / `proposal`。`sourceRefs` はrepo/path/commitと確認範囲を持つ。事実の分類を `verified` の代用にしない。
- `decisionState` は `proposed` / `accepted-for-design` / `blocked` / `superseded`。`verification` は0015のevidence参照から独立判定する。設計採用時点では空でもよいが、製品受入ではrequired evidenceが必要。
- `ownerRole` は必須、未割当の `assignee` はnull。期限未確定は `reviewBeforeGate` でstage/EPを指定し、架空の日付や人名を記入しない。
- `blocked` は `blockedScope`、`reason`、`requiredEvidence`、`resumeCondition` を必須にする。再開後も旧状態・判断者・日時・根拠をhistoryへ残す。
- Riskの `evidenceKind` は `reproduced` / `source-reviewed` / `potential`。`closed` にするには該当profileのfix SHA・再現/回帰・残存riskが必要。予防riskの監視中を事故解決と表現しない。
- ID重複・未知参照・別profileのevidence・新schemaのrequired項目欠落は拒否する。schema更新で過去の欠損をdefault補完してverifiedにしない。historical raw reportは不変とし、無効化理由を別recordへ追加する。

これらは実装案であり、現在のmanifestに存在するfield名やvalidator機能とは区別する。

### 2. ADR 一覧と適用範囲

| ID / 論点 | 基点の状態・根拠 | 維持する決定と今回の具体化 | 再検討 / 決定 gate |
| --- | --- | --- | --- |
| ADR-P01 / profile 境界 | F: main は `desktop-core-v1`、`compatible:false`。D: PR #3 は strict / adapted を分離。[R-MANIFEST], [R-ADR] | Node-backed、Node-less strict、Node-less adapted、MoonBit 新規 app を別 profile にする。adapted の合格を strict や全 Electron app の認定へ転記しない。 | 0006 の manifest / CLI admission 実装前。profile を跨ぐ evidence を拒否する負例が必要。 |
| ADR-P02 / native MoonBit 正本 | F: MoonBit-first の所有規則。D: Node-less native runner 分離。[R-AGENTS], [R-ADR] | P: Node-less は native supervisor/UI host の MoonBit core が lifecycle・IDs・policy・grants・limits を所有。JS realm は関数値と module identity、native leaf は実 OS object を所有する。 | 0006 / 0008 の最初の native integration 前。既存 Node-backed の compiled core 配置が移行済みとは扱わない。 |
| ADR-P03 / QuickJS pin | D: **QuickJS 2026-06-04 / MIT** が選定済み、source SHA-256 は未確定。[R-ADR], [R-TARGETS] 公式配布元でも版と license を再確認した。[U-QJS] | この版を初期候補として vendor source / hash / flags / local patches / C header ABI を固定。別 engine を理由なく再選定しない。 | N1a / 0008。固定 fixture、資源制御、保守・配布条件に重大な不成立がある場合だけ ADR 改訂。 |
| ADR-P04 / strict M0 | F: main strict bridge は未解決。D: PR #3 は初版 No-Go / blocked。[R-MANIFEST], [R-ADR] | P: [0007](0007-context-bridge-feasibility-and-security.md) の public primitive 1 つ・仮説 1 つ・2 checkpoint の有限 spike。数学的な不可能証明とは呼ばない。 | 同期 return/throw と forgery 防止が第 1 gate。callback/Promise/identity/freeze/revocation が第 2 gate。安全性不足のまま期限で Go にしない。 |
| ADR-P05 / app baselines | D: Moji v1.0.5 / jmd v0.2.3 の commit 固定。[R-TARGETS] 今回 source / lock 調査は [0014](0014-real-app-acceptance.md)。 | 主対象 Moji `b7b1d585d61772a0f791f165c8d07a420443b65b`、追跡 jmd `f875fc616feb89ea803a0fc140ec770a2ade041e` を保持。core oracle と upstream app oracle を分ける。 | N0、各 app baseline 収集前。容易な別 app へ置換して既存 acceptance を完了にしない。 |
| ADR-P06 / loader と build | D: original CJS / prepared JS / TS build、runtime Node 不使用。[R-ADR] | P: `inputMode` と `preloadMode` を独立記録。TS emit は build に置く。generated preload・依存 alias・renderer 変更は別 hash と adaptation にする。 | 0008 / 0014 の起動閉包確定前。build 成功、型チェック、runtime の module 解決は別試験。 |
| ADR-P07 / sender と relay | F(PR source/report): PR #2 probe は shared-DOM reply 偽装と initiator 認証不足を報告。未merge の PR #10/#13 は restricted preload の native attestation まで。[R-PROBE], [R-ATTEST] | P: native actual sender と、child が authorized parent に依頼した causal relay を分ける。body の frame/origin/token は authority にしない。 | 0007 の sender ADR / oracle が renderer ingress 前に必須。parent が受けた依頼の起源まで WKFrameInfo で認証できるとは主張しない。 |
| ADR-P08 / file 権限 | D: adapted は native picker / app data の許可範囲。[R-ADR] | P: Main app principal と document ingress grant を分離。grant の発行正本は core、native broker が actual handle・rights・lifetime を検証。recent path は権限ではない。 | 0011 / 0012 の read/save 実装前。trusted Main 自体を hostile code として隔離できたとは扱わない。 |
| ADR-P09 / 保存の意味 | F: 初期 Node-less 保存実装は存在しない。今回の具体化は [0011](0011-app-loading-origin-and-storage.md) / [0014](0014-real-app-acceptance.md)。 | P: Moji adapted は明示的な atomic-replace policy。open-for-edit の read + replace-selected、saveAs 後と通常 save の再保存を試験。standard Node subset の `writeFile` 意味は黙って変えない。 | file broker / Moji M3 前。inode・mode・hardlink 等の差、競合検出範囲、commit 後の outcome unknown を adaptation に記録。 |
| ADR-P10 / OS 順序 | D: macOS Apple Silicon 先行。[R-ADR] F: Windows/Linux GUI backend は main で unsupported。[R-MANIFEST] | P: 最初の製品は macOS arm64。Linux portable 検証を継続し、Linux GUI / Windows は 0018 の独立 lane へ進める。Intel Mac を初期対応へ加えない。 | 次 OS 着手は shared contract と担当実機を確保して判断。OS ごとの bridge / IME / 配布証跡なしに supported を追加しない。 |
| ADR-P11 / bounded IPC | F: main は `tiny-json-tree-v1`。D: PR #12 は versioned undefined codec。[R-MANIFEST], [R-IPC] | P: application values、bridge function handles、private control を分離し、件数・bytes・depth・roots と terminal を bounded にする。完全 structured clone は独立 gate。 | 0010 の codec negotiation / negative tests。上限拡張・streaming・transferable は別変更。 |
| ADR-P12 / evidence と claim | F: CI 成功と未実装が併存、#6 の欠損観測受理を再現。[R-P6], [R-MANIFEST] | P: schema と required observations を version 管理。source / profile / OS / driver scope の欠損は未判定にし、核試験を実機成功へ昇格しない。 | 0015、全製品 gate の前提。比較器変更で過去 FAIL を再実行なしに PASS へ書き換えない。 |
| ADR-P13 / storage 隔離 | D: app data の権限制限。今回 Moji の明示 userData 指定を source で確認。[R-ADR] 詳細は 0011 / 0014。 | P: disposable な実 OS user/data で試験し、app/profile 専用 root と browser store を明示。元 Electron data の自動移行・旧 path の自動承認は行わない。 | 最初の real-app 起動前と persistent storage 導入前。環境変数 HOME の変更だけで隔離済みとは扱わない。 |
| ADR-P14 / 配布と更新 | F: main の run / pack は unsupported。[R-MANIFEST] | P: 初版 adapted preview は署名済み full bundle の明示更新。Node-backed artifact は別。private/test-only native probe を production に含めない。 | 0016 の clean install / Node-free audit / signature / rollback。自動 updater API 互換は独立 gate。 |
| ADR-P15 / version と廃止 | P: 本書 §6 の運用案。既存 release 運用の実績ではない。 | runtime version、profile contract、protocol/codec、evidence schema、data schema、OS/WebView matrix を別 ID にする。互換性の意味変更は versioned migration と失敗理由を伴う。 | 最初の preview tag 前。profile ID 据置きで同期性・権限・値意味を変更しない。 |
| ADR-P16 / license と保守担当 | F: 基点 main の root LICENSE は確認できず、`moon.mod` / `package.json` に配布 license 指定なし。[R-TREE], [R-MODULE], [R-PACKAGE] | P: repository 所有者が自作品の license を決定。実 bundle の SBOM / notices と component 更新担当を別に確定する。MIT 依存から本体 license を推定しない。 | 0016 の再配布 gate。未確定のまま配布可能と表示せず、本書で勝手に license を追加しない。 |

#### 2.1 strict spike の停止と再開

1. 開始 PR に public API、対象 OS/SDK、仮説、既存の失敗 fixture、担当 role、2 checkpoint の判定日を記載する。調査の延長を自動承認しない。
2. 第 1 checkpoint は unchanged preload と最初の page script による同期 return/throw、source/result integrity、reply forgery 防止。成立しなければ同方式への機能追加を停止する。
3. 第 2 checkpoint は同じ方式で nested/reentrant call、callback、Promise、identity、copy/freeze、navigation 失効を試す。別々の toy 実装の結果を合算しない。
4. 判定は `go` / `no-go` / `blocked:不足証跡名`。実機がない場合は未実行。UI thread を待ち続ける方法や page-world privileged preload に切り替えて Go としない。
5. 再開には新しい public primitive、旧反証を覆す検証可能な修正、または製品要件変更の ADR を必要とする。strict blocked の間も、安全性が独立して成立する adapted の work package は進められる。[0007](0007-context-bridge-feasibility-and-security.md)

### 4. Security と障害対応の提案

#### 4.1 保護する境界

1. renderer は任意の入力・直接 native handler 呼出を試みる主体として扱い、native ingress で再検証する。Electron 公式も IPC sender の検証を推奨しているが、electron.mbt の実装証拠は 0007/0010 の native 試験で得る。[U-ELECTRON-SECURITY]
2. trusted app Main、MoonBit core、native broker の権限を混同しない。Main が意図して持つ app 権限を、async global `currentSender` の一時値で制約できるとは仮定しない。
3. native 実装の memory safety と OS process sandbox は別項目とする。C/Objective-C/FFI の検査、fuzz/負例、resource limits を設計し、WebView を使ったことだけで Main や broker の隔離を保証しない。
4. QuickJS の一般 `std/os` library を Node compatibility facade として丸ごと公開しない。外部 bytecode を信頼済み source と同等に読まない。engine manual は bytecode が版依存であり、実行前の安全検査を行わないことを記すため、初期 loader は監査した source/build 入力を使用する。[U-QJS-MANUAL]
5. logs は operation ID / profile / error code / bounded metadata を基本とし、file content、clipboard、private nonce、秘密鍵、環境変数全体を収集しない。再現用入力は synthetic/disposable を優先する。

#### 4.2 報告・切り分け・修復

現在の GitHub 通常 Issues は無効であり、private security reporting の利用可否や担当連絡先は今回確定していない。[0005](0005-existing-work-and-integration.md) 公開 preview 前に `SECURITY.md` 相当の報告経路・supported versions・担当を整える。未設定の窓口や応答 SLA を公開済みと記載しない。

| 分類 | 初動案 | 修復と終了 |
| --- | --- | --- |
| 権限漏洩・実 data loss・配布物汚染 | affected artifact/profile の新規公開を停止し、再現情報と到達範囲を保全。秘密情報を public issue へ貼らない。 | 最小再現、修正、回帰、独立 review、署名済み置換 artifact、残存影響と復旧方法を記録。 |
| evidence の false positive | 該当 evidence / gate の採用を撤回し、依存する claim を unknown/blocked に戻す。 | comparator 修正と元 fixture の再実行。歴史的な raw report を消してなかったことにしない。 |
| app/OS regression | source/profile/OS を固定し、oracle・candidate・環境のどこで差が出るか分類。 | 更新 lane で再現し、修正版または明示した unsupported matrix を発行。 |
| CI/供給元障害 | source/hash/log を保存し、environment failure と semantic FAIL を区別。 | pin を黙って latest に変えず、利用可能な入力で再現し必要な repin を review。 |

運用目標の案は P0 の一次切り分けを担当者の次の稼働日まで、その他の新規報告を 2 稼働日以内に担当へ割り当てること。これは現在の人員に裏付けられた SLA ではない。preview 前に維持できる目標・不在時の代替担当・公開する範囲を決める。修正期限は到達可能性、回避策、配布範囲を確認して個別に設定する。

### 5. Upstream と依存の更新ポリシー案

| 対象 | 固定する入力 | 更新時の必須検証 | Owner role |
| --- | --- | --- | --- |
| QuickJS | tarball URL / SHA-256、license、local patch、headers、compiler flags | C ABI/roots/exception/jobs/limits/CJS、app startup、Node-free package。独自 patch は変更理由と upstream 差分を保持。 | Engine |
| MoonBit / core / build tool | compiler/moon/runtime source と binary hash、取得経路 | JS/native target、FFI ownership、compiled artifact と source SHA、clean build | Build / Core |
| Node-backed runtime | Node exact version と source/binary provenance | Node-backed API/oracle regression と配布容量・更新責任。Node-less artifact へ混入しない。 | Runtime / Release |
| Electron oracle | core fixture の exact Electron / embedded Node、binary hash | baseline validity と旧結果との差。比較対象を変更した事実を保持。 | Evidence |
| App / npm / TS build | Moji/jmd commit、lock、typecheck/emit 設定、produced JS | import 閉包、dependency adaptation、renderer/preload hash、M1〜M3/J1 と SBOM | App / Build |
| OS/WebView/SDK | OS build/arch、実 WebView 情報、SDK/API availability | bridge、load/close、IME/AX/clipboard、signing/clean install。Safari 表示版だけを実 WKWebView 版と断定しない。 | Platform / QA |
| CI actions / release tools | action commit、runner image、tool version、権限 | 最小 permissions、artifact provenance、secret 非公開、署名/更新の再現性 | Build / Release |
| gpui / native libraries | 実際にリンクする revision、公開 adapter 契約、license | UI loop/focus/lifetime/ABI と同梱 component audit。main の `gpuiLinked:false` を実装済みに変えない。[R-MANIFEST] | Native / Release |

1. 開発中は upstream release/security 情報を週 1 回確認し、release candidate ごとにも再確認する運用を提案する。自動検知は更新候補の作成までとし、無検証の自動 publish は行わない。
2. 通常の dependency 更新、security 更新、oracle 基準変更を別に識別する。security 更新も新 artifact / pin / evidence を残し、互換低下を隠さない。
3. 一度に全依存を更新せず、原因を追える単位で変更する。共通 source 由来の build artifact は同じ SHA に束縛し、branch を跨いで混用しない。
4. system WebView は app bundle の engine pin と同じ管理方法にはできない。OS 側で変化し得る条件を runtime matrix と feature detection へ表し、観測できない version は unknown と記録する。
5. upstream source の保存では許諾・provenance・integrity を確認する。基点の MoonBit pin は署名済み upstream checksum ではなく観測 hash と明記されているため、その信頼水準を保存で強めたとは扱わない。[R-MANIFEST]
6. compiler/engine 更新で古い証跡の有効範囲を決め、影響を受ける native/app gates を再実行する。対象外とする理由も記録し、全テストの際限のない再実行を目的化しない。

### 6. Version・release・廃止の管理案

| ID | 用途 | 互換変更の扱い |
| --- | --- | --- |
| runtime release `0.x.y` | 配布 executable と release notes | hash で実体を識別。preview を stable と呼ばず、security fix でも artifact を再発行する。 |
| profile ID + contract hash | API/権限/同期性/許容 adaptation の意味 | 意味を破壊する変更は新 profile revision、明示 migration、旧 evidence の適用範囲を更新。 |
| transport / codec version | frame/value/limit negotiation | 両端の対応を確認し、未知版は typed failure。旧版を読めることと同じ意味で実行できることは別。 |
| evidence schema | required observation・source scope・verdict | reader/migration を version 化。欠損を新規 default 値で補い、verified を生成しない。 |
| app / data schema | settings と saved state の復旧 | data の backup/restore と downgrade 可否を明記。runtime rollback だけで data を戻せたとはしない。 |
| supported matrix | OS/CPU/WebView/profile/app scenario | 当該組合せの実証だけを追加。環境 drift は再認定または一時停止。 |

初期保守範囲は **current preview 1 系列** を提案し、rollback 用の直前の署名済み full bundle とその data/schema 条件を保存する。直前 artifact の保存は、旧系列を無期限に security support する約束ではない。stable を名乗る前に support 期間、backport 対象、OS minimum、security 対応可能な人員を決める。

1. 除去する API/profile は replacement、移行差分、対象 release、未移行時の診断を先に記録する。安全性のため直ちに無効化する場合も影響を隠さない。
2. unsupported を empty object / success ACK / silent fallback に置換しない。strict operation の Promise 化は新たな adaptation として扱う。
3. 任意の運用項目の例外だけを reason / owner / expiry / 残る risk とともに記録する。required observation、native/interactive acceptance、権限・data 保護など製品 gate の不足を免除して verified/supported にしない。対象範囲を縮小する場合は profile/contract を明示変更し、縮小後の required evidence を揃える。
4. 署名 credential、CI configuration、更新 metadata、復旧手順を特定の開発端末だけに依存させない。owner 不在時の手順と access の管理方法を release 前に決める。
5. release artifact、SBOM/NOTICE、source/build/adaptation hash、有効な acceptance report は、その release を提供・保守する期間と rollback に必要な期間保存する。具体的保存先・費用・削除条件は release owner が公開前に確定する。
6. raw interactive recording は証跡に必要な部分だけを取り、個人情報が混入した場合の公開用編集版と原本の保管範囲を分ける。編集で挙動を変えたことにしないよう hash と編集理由を記録する。

### 7. License と再配布の gate

QuickJS の公開 license は MIT、Moji/jmd の pinned root license も MIT と確認されている。[U-QJS], [M-LICENSE], [J-LICENSE] これらの事実だけでは electron.mbt 本体、すべての npm 依存、font/icon/sample、将来リンクする runtime/library の再配布条件の確認を完了できない。ここでは component ごとに根拠を揃える運用を定める。

1. repository owner が本体の source/binary 配布方針を決め、root license と package metadata の整合を review する。現在の `private:true` は配布ライセンスの決定を示す根拠にしない。[R-PACKAGE]
2. bundle の実 file / binary / library から SBOM を生成し、production に残った transitive component を列挙する。lockfile 全体のコピーだけを同梱物一覧としない。
3. component ごとに name、exact version/commit、source URL/hash、license text と取得元、copyright/NOTICE、local modification、build-only/runtime の区分を記録する。
4. 変更した依存、静的リンクした library、配布 asset は必要な notices と source 提供条件を確認する。条件が不明な component はリリースへの追加を保留する。
5. license に影響する更新はコード差分が小さくても review 対象にする。新 engine/library/packager を追加した場合は §5 とこの gate の両方を通す。
6. 終了証拠は actual signed bundle に対応する SBOM/NOTICE、component 欠落検査、本体方針、担当者、対象 artifact hash。[0016](0016-packaging-release-and-updates.md) の release manifest に束縛する。

## 受け入れ条件

### 9. この issue の完了条件

1. ADR-P01〜P16 の状態・owner・適用 profile・変更 gate が参照可能で、既存 Draft 設計と main 実装を混同していない。
2. R01〜R06 の事実を exact SHA と再現範囲で保持し、R07〜R21 の risk に担当・追跡先・次の判断日を設定する。すべてを解決済みへ書き換えることは完了条件ではない。
3. DEC-01〜DEC-11 が 0020 の package に対応し、blocking decision はその package の着手/受入前に判断される。
4. version / security / upstream / license / support のポリシーが実担当者により採用・修正され、必要な機械可読 manifest / CI gate / 運用文書へ実装される。
5. 0004 の製品 stage を進めるたびに residual risk、未実行、unsupported、採用 evidence を更新する。文書を作成しただけで run / pack / strict compatibility を解放しない。

### 状態遷移と証拠の受入例

- [ ] Given Draft PR由来のaccepted-for-designと空の実行証拠、when台帳を読み込む、then設計根拠は保持されるがruntime verifiedは生成されない。
- [ ] Given 欠損観測、別SHA/profile、source-reviewedだけのrisk、when製品gateまたはrisk closedへ遷移させる、then不足理由を返し、元のraw reportを変更しない。
- [ ] Given R01のreproduced FAILと修正版、when新fixtureを実行する、thenfix SHA・拒否結果・affected gate・再収集するmacOS evidenceが結び付く。過去のCI greenだけでclosedにしない。
- [ ] Given owner未割当または本体license未決、whenrelease資格を判定する、then未確定項目と止まるgateが可視で、roleや依存MITから値を補わない。
- [ ] Given 新component/engine/profile更新、when新artifactを準備する、then更新対象に対応する回帰・同梱物・license根拠・rollback条件が要求される。
- [ ] Given blocked decisionの解消証拠、when再開する、then記録したscopeと条件だけを再開し、別OS/profileまで一括でsupportedへ変更しない。

## テスト計画

| 検証 | 入力 / 実行方法 | 期待結果 |
| --- | --- | --- |
| 現状の棚卸し | `rg --files`、現行manifest/package/module/CI、0005の固定sourceを読み照合 | 既存component/pinと未確定license・ownerを混同しない。新たなlicense結論を推測しない |
| JSON schema / ID | 上記予定validatorに最小valid record、duplicate ID、未知EP、欠損ownerRole、未知versionを渡す | validだけ通り、負例はfield/ID付きの診断と非0exitになる |
| 状態遷移 | proposed→accepted-for-design、blocked→再開、別profileのverified、fixなしrisk close | 設計採用と実行証明を分離し、違反遷移を拒否。旧historyを保持 |
| 証拠無効化 | R01の欠損reportと修正版の新reportを並べる | 旧raw bytes/hashは不変。依存claimだけをunknown/blockedへ戻し、新実行の証拠で再判定 |
| 配布照合 | 0016のactual bundle inventoryとcomponent台帳を突き合わせる | 未登録runtime、license根拠欠損、Node-lessへのNode混入を拒否。台帳だけで実bundle auditを代用しない |
| 運用演習 | WebView regression、署名担当不在、更新途中kill、private窓口未設定の4ケースを机上レビュー | affected profile・担当/代替・停止・復旧・必要証跡を実行できる手順として特定する |

現在のsource保全に関する既存回帰は `node --test tests/manifest.test.cjs`。将来の `node --test tests/governance.test.cjs` と `node scripts/validate-governance.cjs` は上記実装PRでentry/README/CIを揃えてから実行する。現時点では未作成でNOT RUN。署名・実incident演習・actual bundle照合も製品経路未実装のため、文書検証のPASSとは別に扱う。

## リスク

### 3. Risk register

優先度は **P0: 証跡の信頼性・権限・データ保護を先に解決、P1: preview 受入の必須項目、P2: 拡張・継続改善** とする。既存レビューの P2 指摘を本計画で P0 とする場合、元レビューの severity を書き換えた意味ではない。role は責任範囲であり、個人への割り当ては repository maintainer が下記の担当台帳で確定し、0020 の対応 EP から参照する。現行0020は role の提案であり、人名を確定済みとは扱わない。

#### 3.1 基点で既に確認した不具合・未完了項目

| Risk / 優先度・状態 | Trigger | 影響 | Owner role / mitigation | 中止・再開条件 |
| --- | --- | --- | --- | --- |
| R01 / P0 / 再現 FAIL | #6 sync probe の 7 candidates をすべて `observed:{}` にして `validateReport` へ渡すと `problems:[]`。[R-P6], [R-VALIDATOR] | 実観測のない結果を PASS と表示し、strict 判断の根拠を誤る。 | Evidence owner。candidate 別 required fields / types / semantic 値を native producer と reader 両方で検証し、欠損・null・wrong-type を反証にする。 | 該当 report を新しい verified 根拠へ使用することを停止。回帰で拒否を確認し、実 macOS 観測を再収集後に再開。 |
| R02 / P0 / source 確認、実機未実行 | #6 の DOM `clipboard.writeText` / `execCommand('copy')` 呼出が OS paste opt-in 外に残る。[R-P6], [R-NATIVE] | developer の clipboard を変更し得る。想定外の side effect と再現性低下。 | macOS host / QA owner。全 clipboard side-effect path を同じ明示 opt-in へ接続し、無許可経路を試験する。 | clipboard を使う probe を個人環境で通常実行する前に修正。opt-out で変更なし・disposable 環境の opt-in で実操作を確認。 |
| R03 / P0 / source 確認、native 例外未再現 | #6 native probe は DOM timeout 時に `NSNull` を格納し、後段で dictionary として nested lookup する経路がある。[R-P6], [R-NATIVE] | probe crash、欠損報告、環境不良と実装欠陥の混同。 | macOS host / Evidence owner。型分岐と timeout terminal を明示し、null/late callback/native crash の fixture を追加。 | timeout/null report の成功扱いを停止。native timeout を注入して structured failure と process cleanup が成立したら再開。 |
| R04 / P0 / 指摘あり、後続は未merge | #5 baseline semantic admission の指摘。#8 は対応実装を持つが別 HEAD。[R-P5], [R-BASELINE] | incomplete / wrong-version oracle を基準に candidate を誤認定。 | Evidence / Integration owner。#8 を依存順に取り込み、R01〜R03 とは別の入口として検証。 | 無効 baseline に依存する gate 昇格を停止。同一統合 SHA の positive / invalid-baseline 回帰で再開。 |
| R05 / P0 / 未統合 | #2/#10/#13 と #8/#9/#11/#12 が別 stack。#2 は古い main 基点で conflict、outdated unresolved 23 threads。[0005](0005-existing-work-and-integration.md) | ID/codec/lifecycle の重複、旧契約の復活、古い CI の誤用。 | Integration / Core owner。0005 の file/API 衝突台帳と scope を維持し、各 thread を修正済み・残存・再現不能に再分類。 | conflict の解消だけで合格にしない。統合後の exact HEAD、compiled-core provenance、必要 native 回帰と独立 review で再開。 |
| R06 / P1 / 設計のみ | QuickJS の source checksum 未固定、native FFI / app 実行 / Node-free bundle は未実装。[R-TARGETS] | engine の選定だけが成果となり、native 製品の成立が未確認。 | Engine / Build owner。0008 の vendor lock、GC/roots/jobs、CJS、limits、native broker を順に実証。 | hash/ABI/ownership 不明の入力を release build に使わない。N1a 証跡と再現 build で次の integration へ進む。 |

R01 は [0005](0005-existing-work-and-integration.md) に再現入力・command・exit 1 を記録している。R02/R03 は source で該当経路を再確認したものであり、今回 developer clipboard の書換えや macOS native exception を起こして確認したとは主張しない。#6 の inline threads が resolved でも、この post-merge comment の 3 指摘を修正済みとはみなさない。

#### 3.2 実装・製品化で監視するリスク

| Risk / 優先度 | Trigger | 影響 | Owner role / mitigation | 中止・再開条件 |
| --- | --- | --- | --- | --- |
| R07 / P0 / sender 誤認 | child/remote frame、stale generation、forged body、authorized parent の relay を同一視。 | 権限漏洩、別 document への結果配送。 | Security / Core owner。ADR-P07、actual native metadata、operation grant、source/lease の負例を 0007/0010 で固定。 | 許可されていない frame/document の直接権限獲得、native identity 偽装、正規返信の偽造があれば affected profile の admission を停止。authorized parent relay は ADR/oracle の期待で別判定。同じ実 backend の攻撃試験と review で再開。 |
| R08 / P0 / 保存権限と data loss | read-only open から無断 write、saveAs 後の再 save、外部 path 差替、rename 後 timeout。 | 誤ファイル更新、旧 data 消失、成功の誤表示。 | Storage / App owner。権限を read/create/replace に分け、handle 検証・commit point・再読込・明示 atomic adaptation を実装。 | M3e/M3f・readonly/競合/late result が未成立なら保存を実用と表示しない。実 bytes と権限失効の確認で再開。 |
| R09 / P0 / source・data の隔離不足 | mutable app root、symlink race、Moji の明示 userData、recentFiles の旧 path を追う。 | 元 app/source/data を変更し、fixture 自体を汚染。 | Storage / QA owner。private quiescent staging、disposable 実 OS user、実 path/read-write trace、元 hash を 0011/0014 で確認。 | 元ユーザーデータに到達する試験を停止。隔離した入力・data root と再現可能な fixture で再開。 |
| R10 / P0 / native 同期・scheduler | main が native reply を待ち、UI が main callback を待つ。無限 JS / microtask、first RPC と full-load 待ちの循環。 | UI freeze、操作不能、close/quit 不成立。 | Engine / macOS host owner。0008 の同期呼出分類、watchdog、0007 の ingress/load 分離を実測。 | UI の無期限停止や再入による権限逸脱があれば該当 API を unsupported に維持。故障注入と event-order fixture で再開。 |
| R11 / P0 / lifetime・resource | close/reload/crash 後の root/ticket、duplicate ACK、expired result、queue overflow。 | stale callback、二重終端、memory/FD leak。 | Core / Engine owner。所有台帳・再検証・quiescence・上限・owner process cleanup を 0009/0010/0017 で照合。 | 未bounded 資源や stale delivery があれば release を停止。repeat/fault 試験の plateau と台帳整合で再開。 |
| R12 / P1 / app 起動閉包 | Moji の eager updater/zlib/Buffer/import、jmd privileged scheme に起動が到達する。 | 選択 scenario へ到達せず、空 stub で隠した成功を作る。 | Loader / App owner。0014 の pinned build output と runtime trace を照合し、unsupported または明示 alias を採用。 | empty object・hidden source rewrite を合格経路にしない。閉包と adaptation hash を確定し、実操作から再受入。 |
| R13 / P1 / engine・言語差 | QuickJS と app が要求する Node APIs / module / locale / scheduling の差。 | 起動・例外・文字処理・callback 順序が変わる。 | Engine / App owner。symbol allowlist と oracle trace を比較し、必要な API だけを実装。QuickJS の言語対応を Node/Electron 対応へ拡張解釈しない。[U-QJS-MANUAL] | 必須操作が意味を保てなければ当該 scenario を blocked。profile adaptation または engine ADR 改訂の review と再試験で再開。 |
| R14 / P1 / UI 実機の欠落 | headless CI、synthetic DOM key、単一 display しか使えない。 | 日本語 IME、VoiceOver、native Menu、focus、DPI の不具合が残る。 | Interaction / macOS QA owner。0019 の手操作・支援技術・実 hardware evidence を独立 lane にする。 | required 項目が NOT_RUN なら製品 gate を閉じない。対象実機の操作記録と issue の再現確認で再開。 |
| R15 / P1 / WebView 更新 | OS/WebKit 更新、WebView2 更新、Linux ABI 差で public API/挙動が変化。 | 署名済み同一 app が既存受入と異なる動作になる。 | Platform / Security owner。OS build と実 runtime の matrix、forward lane、feature detection、対象範囲の再認定を維持。 | 危険な差分の OS/profile 行を一時停止。修正版または確認した安全な範囲だけを再認定。OS 更新を無断で止めて回避しない。 |
| R16 / P1 / toolchain 供給 | MoonBit の versioned object が消える、checksum 不一致、compiler/SDK drift。[R-MANIFEST], [R-CI] | clean build の再現不能、未審査の別 compiler が混入。 | Build owner。許される保存・配布条件を確認して入力を保管し、入手不可は明示 failure。repin は別 PR。 | mismatch を無視した実行は禁止。新 pin の source/provenance と両 target/native 回帰を確認して再開。 |
| R17 / P0 / 配布物の境界破り | Node/libnode/CEF の隠れ同梱・取得、test-only SPI、secret、汚染 artifact を pack。 | Node-less/public API の保証違反、配布先の権限漏洩。 | Release / Security owner。0016 のリンク・spawn・実 process・content・credential audit、test/production target の分離。 | affected artifact の配布を停止。clean rebuild と content/signature/実機 audit を通して新 artifact を発行。 |
| R18 / P1 / update・rollback | 途中終了、誤署名・別 profile の更新、data schema の非可逆 migration。 | 起動不能、data 損失、旧版に戻れない。 | Release / Storage owner。署名済み full bundle、manifest 検証、backup/restore、commit point と schema 対応を 0016 で検証。 | 復旧手順が実証されるまで対象 update channel を公開しない。旧 app/data を保持した fault test で再開。 |
| R19 / P1 / license・継続保守 | 本体 license 未決、依存 notice 不足、engine/OS/build/署名の担当不在。 | 再配布条件を満たせず、脆弱性修正や再署名を継続できない。 | Maintainer / Release owner。ADR-P16、bundle SBOM、担当と代替手順、署名鍵保護、private 報告先を確定。 | 未確定 component を配布物へ追加しない。方針・notices・更新担当を記録後に release gate を再開。 |
| R20 / P1 / 性能根拠 | empty-window のみ、関連 process の計上漏れ、機能差、wire bytes 上限超過。 | 軽量化を誤表示し、実 app の応答性や大文書の失敗を見逃す。 | Performance / App owner。0017 の固定 workload、全帰属 process、raw samples、同条件比較と差分表示。 | 未測定を改善実績にしない。確定 budget と実 release artifact の比較で再開。 |
| R21 / P2 / scope 増大 | strict bridge 研究、別 engine、別 app、他 OS、完全 Node API を同時に広げる。 | macOS adapted preview の完成が遅れる。 | Product / Maintainer owner。0004/0020 の依存順と finite spike、変更した acceptance と見積りを明示。 | critical path に無審査の必須項目を追加しない。ADR で対象・担当・中止条件を固定して着手。 |

R07〜R21 は予想される trigger と受入上の管理策であり、全項目の exploit・事故が観測済みという意味ではない。どの risk も「owner が承認した」だけでは closed にせず、fix SHA / applicable profile / regression evidence / residual risk を記録する。

## 未解決の質問

### 8. 未決事項と決定すべき gate

以下は追加のユーザー質問を今すぐ並べるための項目ではなく、0020 の実装 package が前提を確定するための gate である。既存セッションや repository の判断で決定済みの事項を再承認待ちへ戻さない。

| Gate ID | 未決事項 / 決定する内容 | Owner role | 必要な材料 / 期限 | 0020 の package |
| --- | --- | --- | --- | --- |
| DEC-01 | profile 別 AGENTS / manifest admission、旧 Node-backed 正本との適用範囲 | Maintainer / Core | ADR-P01/P02、既存 scope の保持。Node-less code を追加する前。 | EP-06 / EP-20 |
| DEC-02 | QuickJS source SHA-256、flags、FFI ownership、patch 方針 | Engine / Build | vendor source/license/header、最小 native fixture。N1a の compile 前。 | EP-08 |
| DEC-03 | direct sender と causal relay の許容範囲、file document identity | Security / Core | shared sender ADRとpinned oracle計画はEP-06で確定。actual native metadataの証跡はEP-13/14/15で取得し、production admissionを有効化する前に受入する。証拠を取得するための限定実装は先行可。 | EP-06 / EP-13 / EP-14 / EP-15 |
| DEC-04 | strict spike の仮説・checkpoint 日・再開条件 | Security / Native | 旧負例、public API、実機利用。spike 開始前。証拠不足は blocked を保持。 | EP-07 |
| DEC-05 | Moji 起動閉包、updater/export alias、local disposer variant、atomic save adaptation | App / Engine / Storage | 0014 の pinned build output、hash、原本との差。M1 起動 / M3 保存の各前。 | EP-05 / EP-12 / EP-13 / EP-16 / EP-21 |
| DEC-06 | open-for-edit / saveAs / 通常 save の grant と再保存、永続 grant の対象外範囲 | Storage / Security | 0011/0014 の rights・handle・collision・reopen 負例。file UI の実装前。 | EP-16 / EP-18 / EP-19 |
| DEC-07 | evidence schema の required fields、旧 #5/#6 evidence の invalidation 範囲 | Evidence / Integration | R01〜R04 回帰、新統合 SHA。新たな互換 gate を閉じる前。 | EP-01 / EP-02 / EP-03 |
| DEC-08 | minimum macOS/SDK、実機/interactive QA 担当、Linux/Windows 次 lane の順と担当 | Platform / QA / Product | API availability、実 hardware、共通契約。初 preview matrix と次 OS 着手前。 | EP-23 / EP-25 / EP-29 / EP-30 |
| DEC-09 | performance budget の確定値・測定機・大文書の supported 範囲 | Performance / App | 0017 の同条件 raw baseline、wire bytes、機能差。結果を受入へ使う前。 | EP-26 |
| DEC-10 | 本体 license、SBOM/NOTICE、署名主体、credential 管理、private security 窓口 | Maintainer / Release | 実同梱 component と所有者の方針。外部配布前。 | EP-32 / EP-24 / EP-25 |
| DEC-11 | update channel、data rollback、supported versions、保存先・保持期間・保守容量 | Release / Storage / Maintainer | Preview の手動 full-bundle 置換と復旧条件は公開前。自動更新・data migration の fault/restore は S5 / stable gate で確定。担当者と代替手順も必要。 | EP-27 / EP-28 / EP-32 |

**再開の扱い:** DECごとのownerが表の材料と判断を該当EP/ADRへ残し、そのgateの直前に受入可否を更新する。本issue全体の未決は維持しつつ、schema・component inventory・既知riskの再現は先行できる。無期限の口頭保留を作らず、未確定の日付はreview-before-gateとして追跡する。

## 変更履歴

- 2026-10-17: ADR16件・risk21件・decision11件を、既存PR/sourceと実用化計画へ対応付けて追加。
- 2026-10-17: polish-issueで台帳schema、具体的な配置、最初のPR、状態遷移の正負例、未割当/未決の扱いを追加。fact/design/verificationと実事故/予防riskを区別し、元の全IDと根拠を維持。

## 注記

**準備状態:** schema・固定snapshotの移記・component棚卸し・既知riskの再現は着手可。license/署名/保守の採用とprofile安全性の判断はDECで指定する責任者・材料が揃うまで未決として保持する。

**状態と配置:** 既存の状態ディレクトリは `issues/open` のみで、今回も指定された配置と `open` を維持する。これは着手不可や実装済みという表示ではない。本文の着手条件・未解決事項と、実装後の受入を別々に判定する。未解決事項による保留前の状態・復帰先はいずれも `open`、復帰先パスは本ファイル。新しい状態は追加しない。

`Branch` は次の作業用ブランチ案であり、作成済みではない。既存 PR を引き継ぐときは元の履歴を保ち、同内容を別実装として数えない。今回の変更は本文整備であり、既存 PR の merge、runtime の有効化、license 選択、release の実行を意味しない。

整備基準は指定された [polish-issue](https://github.com/f4ah6o/skills/blob/0f6bc769ccce0ce03c6db0457f6a0c2c8ccd3878/skills/polish-issue/SKILL.md)。確認した最新 main は [`8177cf0`](https://github.com/f4ah6o/electron.mbt/commit/8177cf051976b8d7b9eca25ae7ad8820bb04a719)。それ以前の source/PR/CI の固定 SHA は歴史的根拠として維持し、新 SHA の実行結果へ転記しない。

### 10. 出典と確認範囲

main / PR の状態は 2026-10-17 に取得した snapshot。PR HEAD/base/CI/review の完全台帳と R01 再現は [0005](0005-existing-work-and-integration.md) を参照する。上流一次資料の参照日は同日であり、latest 文書を immutable implementation evidence として扱わない。

[R-AGENTS]: https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/AGENTS.md
[R-MANIFEST]: https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/compatibility/manifest.json
[R-TREE]: https://github.com/f4ah6o/electron.mbt/tree/30c6fc97186e7ecfc8397c799525f00c8e4f0f65
[R-MODULE]: https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/moon.mod
[R-PACKAGE]: https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/package.json
[R-CI]: https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/.github/workflows/ci.yml
[R-ADR]: https://github.com/f4ah6o/electron.mbt/blob/49ec04fac8f1db7212f98ade5a82128f1c4692e5/docs/adr/0001-nodeless-macos-runtime-decisions.md
[R-TARGETS]: https://github.com/f4ah6o/electron.mbt/blob/49ec04fac8f1db7212f98ade5a82128f1c4692e5/compatibility/nodeless-targets.json
[R-PROBE]: https://github.com/f4ah6o/electron.mbt/blob/bdc5886da0483da2b8dbecba21f95556b9263c6b/docs/0003-m0-contextbridge-feasibility.md
[R-ATTEST]: https://github.com/f4ah6o/electron.mbt/blob/9d73ebc6d6389f431f6664ae9f6acacf3fe30599/docs/0008-native-isolated-attestation-events.md
[R-IPC]: https://github.com/f4ah6o/electron.mbt/blob/95c9a3457de3f8b8641232e4ba1d29a273ba6fe0/docs/ipc-main-handlers.md
[R-P5]: https://github.com/f4ah6o/electron.mbt/pull/5#discussion_r4254073465
[R-P6]: https://github.com/f4ah6o/electron.mbt/pull/6#issuecomment-6136804622
[R-BASELINE]: https://github.com/f4ah6o/electron.mbt/blob/13087530502e3944b88fef8854c3123a3cdf90d8/docs/baseline-admission.md
[R-VALIDATOR]: https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/scripts/macos-probe.cjs
[R-NATIVE]: https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/platform/macos/WKNativeProbe.m
[U-QJS]: https://bellard.org/quickjs/
[U-QJS-MANUAL]: https://bellard.org/quickjs/quickjs.html
[U-ELECTRON-SECURITY]: https://www.electronjs.org/docs/latest/tutorial/security
[M-LICENSE]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/LICENSE
[J-LICENSE]: https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/LICENSE
