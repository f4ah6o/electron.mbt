# 0013: Native CLI・診断・開発workflowの実装設計

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / 現行Node CLIを保持し、Node-less製品CLIを追加する計画 |
| 優先度 | P1。run admission/誤成功防止はP0 |
| 依存 | [0006 profile](0006-runtime-architecture-and-profiles.md)、[0008 loader](0008-nodeless-runtime-and-module-loader.md)、[0011 source/data](0011-app-loading-origin-and-storage.md) |
| 関連 | [0015 evidence](0015-oracle-ci-and-evidence.md)、[0016 package](0016-packaging-release-and-updates.md) |

## 1. 現在のCLIと保持する挙動

mainの `cmd/electron-mbt.cjs` は `snapshot`、`doctor`、静的 `compat-check`、help/versionを持つ。snapshotは成功0、doctor/compat-checkはM0 incompleteで2、通常run/packは1で拒否する。PR #2に実験run opt-inがあるが一般互換ではない。

この挙動を既存テストと共に維持する。Node-lessはnative executableをentryにし、shebang Node、Node subprocess、Node addonへ隠れて依存しない。実行名 `electron-mbt` を維持する案を採り、module名 `f4ah6o/electron`、repository名 `electron.mbt` と区別する。

## 2. 利用者の一連の操作

1. `doctor <app-dir>` でapp/build/profile/OSの不足と最初のblockerを確認する。
2. `compat-check <app-dir>` で静的inventoryを作り、必要な実行fixtureと未検証項目を提示する。
3. profileを明示してdevelopment runする。起動前にsource/adapters/data root/未対応を確認できる。
4. 同じsource manifestで実アプリシナリオを検証し、そのevidence IDをpackへ渡す。
5. `pack` がimmutable staged bundleを作り、署名・配布前の検査結果を別に出す。
6. 別環境で配布済みappを起動し、SDKやNodeを必要としないことを確認する。

上記の新しいflags/commandsは実装予定であり、現在利用できる操作としてREADMEへ載せない。

## 3. コマンド設計

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

### 3.1 source/build mode

`inputMode`（original-cjs / prepared-js / ts-build）、`preloadMode`（original / generated-adapter）、`dependencyAdaptations[]`を独立fieldにする。ts-buildとpreload適応を同時に表現する。TSの型検査とemit/bundleを別stepで報告する。元preloadのhashと生成adapterのhash、build alias/置換依存、削除した機能を一覧化する。

出力先はapp sourceと分離した明示directory。source rootや既存app bundleを暗黙に上書きしない。packのdry-runは予定fileと依存を返し、成功bundleができたとは表示しない。

## 4. 診断schema

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

### 4.1 エラー例の契約

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

## 5. Exit statusとログ

既存CLIの0/1/2契約を回帰で維持する。native CLI v1の提案は、0=要求した操作の成功、1=usage/I/O/実行失敗、2=profile/gate未充足とする。harness errorや差分はJSON内のtyped resultで区別し、exit0のまま失敗が隠れる構成を作らない。

互換のないprofileでの「未対応を正しく拒否する負例」はtest自身がPASSになり得るが、対象アプリのstatusはblocked/failedのまま。reportを二段にする。

stdoutは選択したJSONまたは人向け出力、stderrは進捗と診断。child stdoutにアプリ自身が文字列を出しても、trusted completion markerやhandshakeと混線させない。protocolは専用channelを用いる。

## 6. 開発loopとCIの再現性

1. 既存 `npm run build`、MoonBit JS/native、Node boundaryをbaseline laneとして維持する。
2. Node-less native build/testを独立commandにし、実装時にREADMEとCIと同じentryから呼ぶ。
3. OS別probe、oracle、app scenarioは同じCLI/task entryをローカルとCIで実行する。CI YAMLのみに試験手順を埋め込まない。
4. actrunを使用する場合は同じentryの薄い実行wrapperとして追加する。actrun成功をmacOS GUI実行の代用品にしない。
5. watch/reloadはapp source hashが変わるたびに新document/sessionを作り、旧権限・callbackを保持しない。
6. stale generated coreを誤読しないようbuild SHAをhandshake/evidenceへ持たせる。
7. debugger/source mapはMainとrendererを分ける。Electron DevTools/CDP互換は未対応を保持し、WK inspectorの利用条件を別に案内する。
8. dev serverは明示opt-inかつ限定bind/originで使い、pack済profileへ持ち込まない。

## 7. 対応状況の表示

static inventoryでunknown APIが見つからないことは、動的分岐・reflection・future dependencyが対応済みという証明ではない。runtime first-use診断とscenario coverageを併記する。

`doctor`には次に解決すべきblockerを優先順で最大数付き表示し、全inventoryはJSONへ残す。Mojiでは例えばtop-level import、userData override、初回getSettings、adapter登録を別項目にする。単一の「not supported」で開発を止めない。

## 8. 分割PRと受入

1. schema/exit/report testsを先に固定する。
2. native inventory/doctorを実装しNode依存なしで実行する。
3. runtime/version/profile admissionとsafe runを接続する。
4. pack/inspectのmanifestを0016へ接続する。
5. verify/dev loopを実app/evidenceへ接続する。

受入はhelp/version/usage、space・日本語path、missing module、stale evidence、strict/adapted取り違え、no-Node PATH、host crash、cancel、machine JSON parse、ソース不変性を含む。GUI testはmacOS実行結果を要し、LinuxのCLI成功で昇格しない。

## 9. 出典

1. [現行CLI](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/cmd/electron-mbt.cjs)
2. [現行package.json](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/package.json)
3. [PR #2 experimental runner](https://github.com/f4ah6o/electron.mbt/pull/2)、[PR #3 source/build modes](https://github.com/f4ah6o/electron.mbt/pull/3)
