# 0013: Native CLI・診断・開発workflowの実装設計

Status: polished
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: feat/issue-0013-native-cli

## 概要

**性質:** Node-less製品CLIと既存診断契約の実装Issue。**利用者への影響:** source/profile/環境の不足を具体的に確認し、検証済scopeのrunと再現可能なpackへ進める。静的inventoryやdry-runを実アプリ成功として表示しない。

| 項目 | 内容 |
| --- | --- |
| 優先度 | P1。run admission/誤成功防止はP0 |
| 依存 | [0006 profile](0006-runtime-architecture-and-profiles.md)、[0008 loader](0008-nodeless-runtime-and-module-loader.md)、[0011 source/data](0011-app-loading-origin-and-storage.md) |
| 関連 | [0015 evidence](0015-oracle-ci-and-evidence.md)、[0016 package](0016-packaging-release-and-updates.md) |

最初の限定PRは[0020 EP-20](0020-implementation-work-packages.md)のschema/exit/golden fixtureとnative inventory入口。既存Node CLIの拒否契約を保ったまま着手できる。

## 背景

### 1. 現在のCLIと保持する挙動

mainの `cmd/electron-mbt.cjs` は `snapshot`、`doctor`、静的 `compat-check`、help/versionを持つ。snapshotは成功0、doctor/compat-checkはM0 incompleteで2、通常run/packは1で拒否する。PR #2に実験run opt-inがあるが一般互換ではない。

この挙動を既存テストと共に維持する。Node-lessはnative executableをentryにし、shebang Node、Node subprocess、Node addonへ隠れて依存しない。実行名 `electron-mbt` を維持する案を採り、module名 `f4ah6o/electron`、repository名 `electron.mbt` と区別する。

この整備で [CLI source](../../cmd/electron-mbt.cjs)、[package scripts](../../package.json)、[manifest tests](../../tests/manifest.test.cjs)、[core integration tests](../../tests/core-integration.test.cjs) を照合した。`run/pack`はapp pathを検査・評価する前に `ELECTRON_MBT_M0_INCOMPLETE` を返し、doctorはcompiled coreを要する。新flags/verify/inspectはこのsourceに実装済みではない。

## 問題

現行CLIはNode executableとcompiled JS coreを要し、Node-less bundleの製品入口には流用できない。単一の `compatible`、未対応APIをまとめたerror、静的scanだけでは、実行済scope・依存の起動失敗・adapter差・古いevidenceを利用者が区別できない。

native CLIを追加する際には、旧CLIのexit 0/1/2と新profileのadmissionを混ぜない契約が必要である。sourceを上書きする出力先、child stdoutの成功marker、明示されないfallbackは受入対象にしない。

## 目標

- help/version/snapshot/doctor/compat-checkの既存挙動を保持し、native側で同じ診断目的を実現する。
- inputMode/preloadMode/dependency behavior・実engine・app/source/evidenceを独立fieldで提示する。
- run前にprofile/hash/gateを検証し、未知や不整合を作用前に拒否する。
- inspect/verify/packを新規commandとして実装・検証した時点だけ公開し、署名/公開/実行を別結果にする。

## 対象外

本Issue単独でのruntime/bridgeの実装、厳密contextBridgeのgate解除、全appのunsupported解消、Electron DevTools/CDP互換、サイト公開/配布操作は含めない。通常runを診断の別名にせず、検証前の実アプリを暗黙に起動しない。watch/dev serverは明示した開発modeに限定する。

## 提案する方針

### 2. 利用者の一連の操作

1. `doctor <app-dir>` でapp/build/profile/OSの不足と最初のblockerを確認する。
2. `compat-check <app-dir>` で静的inventoryを作り、必要な実行fixtureと未検証項目を提示する。
3. profileを明示してdevelopment runする。起動前にsource/adapters/data root/未対応を確認できる。
4. 同じsource manifestで実アプリシナリオを検証し、そのevidence IDをpackへ渡す。
5. `pack` がimmutable staged bundleを作り、署名・配布前の検査結果を別に出す。
6. 別環境で配布済みappを起動し、SDKやNodeを必要としないことを確認する。

上記の新しいflags/commandsは実装予定であり、現在利用できる操作としてREADMEへ載せない。

### 3. コマンド設計

| command案 | 主な入力 | 成果 / 制限 |
| --- | --- | --- |
| `snapshot <app-dir>` | trusted source | file hash、symlink、build/adaptation差分。不変性検査のみ |
| `doctor <app-dir> --profile <id>` | app/profile/environment | API/module/engine/WebView不足、data policy、次の操作 |
| `compat-check <app-dir> --profile <id>` | inventory＋既存evidence | evidenceの適用可否。静的解析でcompatible trueにしない |
| `verify <app-dir> --scenario <id>` | pin済fixture・oracle/candidate | 実行traceと結果。native/interactiveは環境別 |
| `run <app-dir> --profile <id>` | accepted profile/manifest | profile内の実行。strict blocked時にadaptedへ自動移行しない |
| `pack <app-dir> --profile <id>` | build/source/evidence pins | bundle+manifest+audit。publicationは別操作 |
| `inspect <bundle>` | 配布物 | version/profile/content/dependency/signature状態 |

`verify`、`inspect`、各flagは提案。実装PRでusageとexit contractを確定し、CLI snapshot testを追加する。`run`を単なるdoctorの別名にしない。

#### 3.1 source/build mode

`inputMode`（original-cjs / prepared-js / ts-build）、`preloadMode`（original / generated-adapter）、`dependencyAdaptations[]`を独立fieldにする。ts-buildとpreload適応を同時に表現する。TSの型検査とemit/bundleを別stepで報告する。元preloadのhashと生成adapterのhash、build alias/置換依存、削除した機能を一覧化する。

出力先はapp sourceと分離した明示directory。source rootや既存app bundleを暗黙に上書きしない。packのdry-runは予定fileと依存を返し、成功bundleができたとは表示しない。

### 4. 診断schema

| field | 内容 |
| --- | --- |
| `schema`, `command` | versioned machine-readable契約 |
| `runtime`, `profile`, `build` | 実engineとcommit、profile hash |
| `status` | completed / blocked / failed / not-run |
| `compatible`, `supportScope` | 適合結果とunit/kernel/native/app/releaseの範囲 |
| `source` | app revision、Main/preload/assets/lock/build/adapter hashes |
| `environment` | OS/arch/SDK/WebView/engineと検出可否 |
| `blockers[]` | code、場所、観測原因、必要な対処 |
| `gates[]` | required/observed/evidence/result |
| `adaptations[]` | 何を変更し、どの操作へ影響するか |
| `evidence[]` | immutable ID、artifact hash、適用source/runtime |

個人情報、cookie、token、file内容、raw IPC bodyをdefault出力しない。pathは利用者の診断に必要なローカル表示と、共有用reportのredacted表示を選べる。未知の原因を断定したrepair命令は出さない。

#### 4.1 エラー例の契約

| code案 | 場所 | 観測できる原因 | 提示する対処 |
| --- | --- | --- | --- |
| `UNSUPPORTED_API` | module/symbol/call site | profileで未実装 | 必要API issue、profile差分の確認 |
| `MODULE_NOT_SUPPORTED` | import chain | 許可外builtin/package | boot inventoryの該当依存を表示 |
| `BRIDGE_GATE_OPEN` | preload/profile | strict gate未受入 | 0007の不足fixtureとevidence |
| `STALE_DOCUMENT` | window/generation | requestの世代が失効 | 現在documentから再操作。副作用を自動再送しない |
| `WEBVIEW_UNAVAILABLE` | OS/backend | runtime/API不在 | 必要versionと明示導入手順 |
| `APP_DATA_POLICY_DENIED` | path operation | app/grant範囲外 | 保存先/明示grantの確認 |
| `EVIDENCE_MISMATCH` | run/pack admission | source/runtime/hash不一致 | 一致する再検証を実行 |
| `OUTCOME_UNKNOWN` | side-effect request | ACK前に通信断 | 結果照合と利用者への実状態提示 |

正式prefixは既存 `ELECTRON_MBT_*` と統一し、コード互換を壊さない。上の短縮名をそのまま実装済codeとして公開しない。

### 5. Exit statusとログ

既存CLIの0/1/2契約を回帰で維持する。native CLI v1の提案は、0=要求した操作の成功、1=usage/I/O/実行失敗、2=profile/gate未充足とする。harness errorや差分はJSON内のtyped resultで区別し、exit0のまま失敗が隠れる構成を作らない。

互換のないprofileでの「未対応を正しく拒否する負例」はtest自身がPASSになり得るが、対象アプリのstatusはblocked/failedのまま。reportを二段にする。

stdoutは選択したJSONまたは人向け出力、stderrは進捗と診断。child stdoutにアプリ自身が文字列を出しても、trusted completion markerやhandshakeと混線させない。protocolは専用channelを用いる。

### 7. 対応状況の表示

static inventoryでunknown APIが見つからないことは、動的分岐・reflection・future dependencyが対応済みという証明ではない。runtime first-use診断とscenario coverageを併記する。

`doctor`には次に解決すべきblockerを優先順で最大数付き表示し、全inventoryはJSONへ残す。Mojiでは例えばtop-level import、userData override、初回getSettings、adapter登録を別項目にする。単一の「not supported」で開発を止めない。

### 8. 分割PRと受入

1. schema/exit/report testsを先に固定する。
2. native inventory/doctorを実装しNode依存なしで実行する。
3. runtime/version/profile admissionとsafe runを接続する。
4. pack/inspectのmanifestを0016へ接続する。
5. verify/dev loopを実app/evidenceへ接続する。

#### 最初のPR・既存/新規の境界

| 対象 | 変更内容 | 後続の入口 |
| --- | --- | --- |
| `tests/manifest.test.cjs`、`tests/core-integration.test.cjs` | 現行exit/JSON/source非評価と新schemaのgolden/negativeを別fixtureにする | Node回帰を保持 |
| `compatibility/` | runtime/profile/source/evidenceのversioned CLI report契約を追加 | 0006/0015のschemaと対応付け |
| `cmd/`の新native entry、MoonBit診断module（予定） | help/version、source inventory、doctorの順で追加 | `cmd/electron-mbt.cjs`はNode-backed入口として存置 |
| 新run/verify/pack/inspect配線（予定） | EP-10/11/14/15等の実runtimeと0016のartifact admissionへ接続 | 依存の実証前は理由付きgate拒否 |

最初のsliceでnative help/inventoryを動かしても、通常run/packが完成したとは表示しない。実装PRごとにusage、field type/required項目、unknown schemaへの拒否、旧reportの読取可否を固定し、公開CLIの互換変更を同じ差分へ記録する。

## 受け入れ条件

- [ ] Given 現行Node CLI, when snapshot/doctor/compat-check/run/packを実行する, then 既存0/2/2/1/1と未達理由が保たれ、run/packはappを評価しない。
- [ ] Given same sourceと明示profile, when native doctor/compat-checkを実行する, then source/build/adapterと実engineが区別されたparse可能なJSONが得られ、static-onlyはcompatibleへ昇格しない。
- [ ] Given stale evidence・unknown profile・strict/adapted取り違え, when run/pack admissionを試す, then Main評価・file変更・別runtime起動前に理由付き拒否される。
- [ ] Given trusted appがstdoutへ偽成功markerを出す, when verifyする, then private channel/exit/required observationsを満たさない結果はPASSにならない。
- [ ] Given dry-runまたはinspectのみ, when 結果を表示する, then 未生成bundle・未署名・未実行をそのまま区別しsourceを変更しない。

受入はhelp/version/usage、space・日本語path、missing module、stale evidence、strict/adapted取り違え、no-Node PATH、host crash、cancel、machine JSON parse、ソース不変性を含む。GUI testはmacOS実行結果を要し、LinuxのCLI成功で昇格しない。

## テスト計画

### 6. 開発loopとCIの再現性

1. 既存 `npm run build`、MoonBit JS/native、Node boundaryをbaseline laneとして維持する。
2. Node-less native build/testを独立commandにし、実装時にREADMEとCIと同じentryから呼ぶ。
3. OS別probe、oracle、app scenarioは同じCLI/task entryをローカルとCIで実行する。CI YAMLのみに試験手順を埋め込まない。
4. actrunを使用する場合は同じentryの薄い実行wrapperとして追加する。actrun成功をmacOS GUI実行の代用品にしない。
5. watch/reloadはapp source hashが変わるたびに新document/sessionを作り、旧権限・callbackを保持しない。
6. stale generated coreを誤読しないようbuild SHAをhandshake/evidenceへ持たせる。
7. debugger/source mapはMainとrendererを分ける。Electron DevTools/CDP互換は未対応を保持し、WK inspectorの利用条件を別に案内する。
8. dev serverは明示opt-inかつ限定bind/originで使い、pack済profileへ持ち込まない。

| 現存command / 追加予定 | 前提 | 期待する観測 |
| --- | --- | --- |
| `node --test tests/manifest.test.cjs` | READMEの対応Node、repository root | 未達manifest/run/pack拒否、snapshot不変、oracle不足の診断 |
| `npm run build` 後 `node --test tests/core-integration.test.cjs` | pinned MoonBit/Node/compiler | doctor/compat-checkのstructured non-success |
| `node cmd/electron-mbt.cjs --help` / `--version` | Node | 両方JSON・exit 0。`--help`はusageとrun/pack未実装、`--version`はversion・milestone・compatible:falseを表示 |
| `node cmd/electron-mbt.cjs snapshot fixtures/cjs` | trusted fixture | exit 0、再実行で同hash |
| `node cmd/electron-mbt.cjs doctor fixtures/cjs` | compiled core | exit 2、compatible:false、app非評価 |
| 新native command | 実装PRが同じCLI/CI entryを追加 | 上のcontractに加えno-Node launch、host loss、profile/evidence負例。現時点NOT_RUN |

これらはテスト計画であり今回のruntime実行結果ではない。mainのbinがNode shebangであることと、将来bundleのnative launcherを分離して検証する。

## リスク

| リスク | 対応 |
| --- | --- |
| exit/schemaの変更が既存automationを壊す | 現行golden/negativeを保持し、native v1と旧Nodeの差をversionで明示 |
| static/negative成功をapp成功へ昇格する | test statusとscenario verdictを別fieldにし、required evidenceを照合 |
| developer fixtureが通常runの安全性gateを迂回する | verify/test-onlyの実行範囲と製品admissionを別契約にし、未証明のrenderer権限を開放しない |
| error/reportがpath/token/dataを漏らす | local診断と共有redacted reportを区別し、payload/secretを既定で出力しない |
| stale build/sourceを混ぜる | handshake/hash/evidence mismatchを起動前に拒否、silent rebuildや上書きをしない |

## 変更履歴

- 2026-10-17: ユーザー指示により `issues/open` から `issues/polished` へ移動し、`Status: polished` と現行参照を同期。実装の準備状態・未解決事項・受入証拠は変更していない。

- 2026-10-17: native CLIのcommand/input/schema/exit、source modes、dev loop、admission設計を追加。
- 2026-10-17: `polish-issue`で実CLI/テストを読取確認し、現行commandと新規command、最初のschema/doctor slice、observable negative、migrationと変更対象を具体化。必須metadata/構成へ再配置し旧節anchorを保持。runtimeや公開CLIは未変更。

## 注記

- 2026-10-17: ユーザー指示「mv to issues/polished」に従い、整備済みの計画を open から polished へ移動。未解決事項・依存条件・runtime の未受入は本文に保持する。

**状態と配置:** 2026-10-17 のユーザー指示により `open` から `polished` へ移動した。現在の保存先は `issues/polished/0013-cli-diagnostics-and-developer-workflow.md`。`polished` は計画の整備状態であり、runtime の受入や未解決事項の解消を示さない。着手は本文の準備状態・依存条件に従い、受入は [AGENTS.md](../../AGENTS.md) と各試験の実証で判断する。進捗と再開条件は本ファイルへ記録する。

- **準備状態:** schema/exit/golden fixtureとnative inventory/doctorの限定実装には着手可能。このIssue固有の未決の安全設計はなく、通常run/pack/verifyの製品受入は0006/0007/0008/0011/0015/0016の実証を消費する後続作業。依存未実装をCLI全体の保留理由にしない。
- **再開・記録先:** 未解決事項と後続依存は本文の証拠・担当role・再開条件で判断し、進捗は本ファイルへ記録する。状態を変更するときはmetadataと配置を同時に更新する。
- **ブランチ:** `Branch` の `feat/issue-0013-native-cli` は実装時の提案名であり、この整備で作成したbranchではない。既存PRの履歴を消さず、小さい統合PRへ分ける。
- **確認基点:** 本整備のmainは `8177cf051976b8d7b9eca25ae7ad8820bb04a719`。初回設計の `30c6fc97186e7ecfc8397c799525f00c8e4f0f65` と各PR/appの固定SHAは履歴根拠として保持する。mainへのPR統合・runtime実装・native E2E完了を意味しない。
- **検証の範囲:** 2026-10-17のpolishはIssueと関連source/testの読取・文書整合を対象とする。下記のruntime/GUI/配布試験は、この本文更新では実行していない。実行する際はcommand、対象SHA、環境とPASS / FAIL / NOT_RUNを別記録にする。

### 9. 出典

1. [現行CLI](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/cmd/electron-mbt.cjs)
2. [現行package.json](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/package.json)
3. [PR #2 experimental runner](https://github.com/f4ah6o/electron.mbt/pull/2)、[PR #3 source/build modes](https://github.com/f4ah6o/electron.mbt/pull/3)
