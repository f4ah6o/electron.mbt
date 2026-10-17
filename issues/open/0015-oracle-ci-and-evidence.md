# 0015: Oracle・CI・証跡・互換判定の実装設計

Status: open
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: fix/0015-evidence-admission

## 概要

証跡の欠損・誤分類から verified が作られないよう、既存 oracle / differential / native probe の admission を実装する P0 issue。利用者には、静的診断・実行完了・同値・未対応・実機未実行が区別された結果を返す。

| 分類 | 決定 |
| --- | --- |
| 性質 | 既知不具合の修正＋evidence schema/CI の実装 |
| 最初の対象 | #6 の missing observation、#5/#8 の saved-baseline admission |
| 最初の branch | `fix/0015-evidence-admission`（提案、未作成） |
| 利用者への影響 | コマンドが exit 0 でも非互換である場合を明示し、無効 report を認定に使わない |

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / 実用化の判定を支える最優先基盤 |
| 優先度 | P0 |
| 既存作業 | PR #5 differential、#6 probes、#8 baseline admission、#9/#11/#12 kernels |
| 依存 | [0005 棚卸し](0005-existing-work-and-integration.md)、[0006 profile](0006-runtime-architecture-and-profiles.md) |
| 受入先 | [0014 apps](0014-real-app-acceptance.md)、[0016 release](0016-packaging-release-and-updates.md)、[0019 interaction](0019-native-interaction-and-accessibility.md) |

## 背景

### 2. 参照を三種類に分ける

| lane | pin | 目的 |
| --- | --- | --- |
| Core Electron oracle | Electron 44.7.0、Node 24.21.0、source commitを現manifestから固定 | core/API契約を継続比較 |
| Upstream app baseline | Moji/jmdの固定source・lockfile・元Electron version | そのappが元配布条件でどう動くか |
| Forward-compatibility | 意図して更新したElectron/WebView/toolchain | drift検出。既存認定を自動上書きしない |

Moji lockのElectron 43.1.0、jmd lockの35.7.5とcore oracle 44.7.0を混同しない。どの基準で判定したかをapp scenarioへ明記する。latest検索結果はpinでも実行証拠でもない。

polish では `scripts/oracle.cjs`、`scripts/differential.cjs`、`scripts/macos-probe.cjs`、`core/differential.mbt` と対応 tests/native producer を読み直した。現 `oracle.cjs` は `fixtures/oracle` 専用で、絶対パスの Electron executable を 1 個受け取り、completed / Electron 44.7.0 / Node 24.21.0 / source hash を確認する。Moji/jmd 用 collector として引数だけ変更して使うことはできない。[現 source](https://github.com/f4ah6o/electron.mbt/blob/8177cf051976b8d7b9eca25ae7ad8820bb04a719/scripts/oracle.cjs)

## 問題

### 1. 試験成功と互換性を別にする

既存の全open PRにはHEAD対応CI成功があるが、full oracleはmainでipcMain、別stackでBrowserWindow等に止まる。partial kernel一致、expected unsupported、probeの想定結果、full app完了を同じPASS欄で集計しない。

PR #6のmissing observation受理は現mainソースで再現確認されている。[0005](0005-existing-work-and-integration.md)の反証を先行回帰にする。`{}`を両側で比較してequivalent、process exit0だけでcomplete、`NOT_RUN`をexpectedとしてverifiedへ昇格させる経路をなくす。

`validateReport` の現 positive fixture は全 candidate の `observed:{}` を許す。native 側の `scriptMessageHandlers` は missing が `@YES/@NO` に一致しない場合に想定通りと分類できる。`readBaseline` も saved report の `observed` が object かという弱い入口を持つ。さらに `compare_observations` は任意 object の比較をする関数なので、空 object 同士の一致から「必要な観測が採れた」とは判断できない。[0005 §5](0005-existing-work-and-integration.md#5-優先する既存指摘と最小再現)

現 differential の exit 0 は比較処理が完了したことを表し、`comparison.verdict:'diverged'` と `compatible:false` を伴い得る。修正対象はこの exit 契約の無断変更ではなく、有効 baseline の admission と verdict の解釈である。

## 目標

1. malformed / missing / wrong-pin / stale-source / synthetic-driver の report を、実行範囲に応じて invalid・unknown・unit-only に分類する。
2. 同じ profile/source/driver の必要な semantic observations が揃った場合だけ、その scope の比較を成立させる。
3. reference の意図した負の観測と candidate の未対応を保存し、失敗を消す normalization を許さない。
4. 固定 command と必要な実機 lane で第三者が主要結果を再現できる。

## 対象外

- strict contextBridge / native host / 実アプリ / updater 本体をこの issue だけで実装すること。
- CI の成功件数だけを増やす変更、NOT_RUN を verified に変える規則、任意 stdout marker の自己申告だけによる認定。
- core oracle の版を Moji/jmd の locked Electron へ置き換えること、raw evidence の上書きで過去 FAIL を消すこと。
- 旧 schema を読めることを理由に、新 schema の required field を default で埋めること。

## 提案する方針

### 最初の bounded slice と責務

0005 / EP-01 が取り込み単位を管理し、本 issue が validator 契約を所有する。初回は次の範囲だけを変更する。

| 既存 / 新規予定 | Path | 入力 → 出力 / エラー |
| --- | --- | --- |
| 既存 | `scripts/macos-probe.cjs::validateReport` | `(probeName, report)` → `{problems,warnings}` を維持。executed candidate の required observation 欠損は problems、理由付き NOT_RUN/stalled は warnings。互換 gate は閉じない |
| 既存 | `platform/macos/WKSyncBridgeProbe.m` | native observation の型・存在を先に検証して outcome を計算。欠損を `NO_PUBLIC_SYNC_PROXY` の根拠にしない |
| 既存 | `platform/macos/WKNativeProbe.m` | DOM clipboard も opt-in、NSNull を dictionary と扱わず原因付き terminal report。user clipboard を既定で変更しない |
| 既存 | `tests/macos-probe-validation.test.cjs` | 真の field を持つ positive、missing/null/wrong-type、NOT_RUN/PARTIAL を別 fixture にする |
| PR #8 を再利用 | saved baseline validator / `scripts/differential.cjs` / core export | 無効 baseline は candidate 起動前に exit 1。report 出力先はテストの temporary path と production evidence を分離 |
| 新規予定 | `compatibility/evidence-schema-v2.json`、schema admission test | source/profile/driver/required-observation の versioned 契約。既存 schema 1 の reader と利用可能範囲を明示 |

### Native producer を基準に固定する required observations

| candidate | 最初に型・存在を検査する native output | 値の意味 |
| --- | --- | --- |
| crossWorldFunctionReference | `pageFnVisibleFromIsolated`、`isolatedFnVisibleFromPage` の string | 想定値 `undefined` と実際の異値を区別 |
| domEventDispatchChannel | `isolatedListenerCalls` array、`syncRoundTripViaSharedDom` boolean、`writeBack`、`dispatcherCaughtThrow` | 現 producer の throw は false または String(error)。非 false を正常な「throw なし」に丸めず、callable/回数/観測欠損を検査 |
| sharedLocalStorage | `pageWrite`、`isolatedRead` の明示 string/null variant | API の拒否を含む実測値として保存。キーの不存在とは区別 |
| jsDialogChannel | prompt/confirm の値・時間・typeof、`delegateCalls` array | null を許す field と missing を分離。実測した delegate 不達を消さない |
| scriptMessageHandlers | `plainIsPromise`、`replyIsPromise`、`settledSynchronously` boolean、return types / deliveries | false/true と missing は別。想定に反する同期性は inconclusive として review |
| evaluateJavaScriptAsync | `value`、`completionOnLaterRunLoopTurn` boolean | `1+1` の値と later-turn の実測を検査 |
| syncXhrToUrlSchemeHandler | `xhr` の結果/例外 variant、`schemeTasks` array | 文字列応答・拒否・未完了を区別し、proxy 互換へ昇格しない |

この表を pin した producer の output shape と照合して schema 化する。全部を non-null にする検査は採らない。`executed:false` の分岐は理由付き未実行として別に定義し、coverage の asExpected/unexpected/notExecuted 等を要素数から再計算する。malformed の詳細は `candidates.<name>.observed.<field>` の path 付きで返し、例外を投げて report 全体を失わない。

### 3. Evidence bundle案

新規schemaを追加する際、現行schema1 readerを黙って意味変更せず、versioned reader/migrationと負例を用意する。

| 区分 | 必須項目 |
| --- | --- |
| identity | evidence schema、run ID、attempt、job、collection時刻、artifact digest |
| profile/adaptation | profileId/profileHash、inputMode、preloadMode、dependencyAdaptations、adaptation manifest hash、比較モード |
| source | repo SHA/tree、fixture hash、app commit、Main/preload/assets、lock/build/adapter hashes |
| candidate | runtime commit、compiled-core hash、native binary hash、engine source/build flags |
| oracle | Electron exact version、source commit、embedded Node version、binary hash |
| environment | OS build/arch、SDK、WebView実version、display/input/GUI availability |
| execution | command/argv、exit code、signal、timeout、start/end、actual driver scope |
| observations | required step IDs、value/exception/event trace、native sender/context、raw metric |
| verdict | harness status、semantic match、supported scope、gate、不足evidence |
| integrity | before/after source hashes、raw log hash、report hash、採用normalization ID |

user codeのstdout markerを唯一の成功根拠にしない。native/runnerの信頼済channelとprocess exit、required observationsを照合する。証跡はrevisionを含むpath/IDで参照し、`evidence/foo.json`という動くpathだけでverifiedを維持しない。

Actions artifactは期限付きである。公開releaseの根拠は保存先とdigestをrelease manifestに固定し、元artifactの期限切れを区別する。個人data・tokenは公開証跡へ含めない。

### 4. Admissionの決定順

1. input全体のbyte/depth/node上限とschemaを検証する。
2. oracleのprocessがcompleted/exit0であること、signal/timeout/異常markerがないことを確認する。
3. 必須semantic observationの存在、型、期待値、trace終端、重複stepを検査する。
4. oracle/candidateの比較モードを検証する。strictは同一source/preload/assetsと宣言build条件をhash照合する。adaptedは同一upstream inputに対する元buildとcandidate変換・生成preload・依存aliasの別hashを照合し、許可されたadaptation manifestとの差だけを認める。profile ID/hashとinputMode/preloadModeが一致しないevidenceでstrict gateを閉じない。
5. candidateの実driverを確認し、synthetic senderやfake nativeならscopeをkernel/unitに限定する。
6. candidate process完了とsemantic値を比較する。既知unsupportedを適合成功へ変換しない。Node-backed/adaptedのpassedをNode-less strictへ代入するreportをschema/admission段階の負例で拒否する。
7. required profile gateを集約し、evidence欠損・未実行・mismatchがあればverifiedを拒否する。

#### 4.1 Verdict table

| 状態 | harness | semantic | app/profile結果 |
| --- | --- | --- | --- |
| 両方有効、対象範囲一致 | completed | equivalent | 当該scopeのみpassed |
| valid oracle、candidate差異 | completed | diverged | failed/unsupported |
| oracle incomplete/欠損 | invalid-evidence | 未判定 | unknown、再収集 |
| candidate timeout/crash | failed | 未完了trace | failed、原因別診断 |
| native環境なし | not-run | 未判定 | 未実行 |
| 負例が期待どおり拒否 | test completed | expected-rejection | negative test PASS、appはblocked |
| unit/kernelのみ一致 | completed | equivalent | native/appは未検証のまま |

### 5. 比較器の設計

MoonBit coreが比較結果・gateを所有する。JSは実engine実行と観測抽出のleafにする。

1. field-level値比較、traceの必要な先後関係、normalized ID対応を別にする。
2. PID、時刻、runtime固有versionは記録するが、生値一致を要求しない。
3. path/URL/origin、例外、同期/非同期、missing/undefined/null、callback回数は意味があるため勝手にnormalizationしない。
4. optional fieldはschemaで宣言し、何でもoptionalにしてmissingを成功させない。
5. comparator自体にwrong version、empty observations、duplicate completion、source drift、stale compiled-core、replayed artifact等の反証fixtureを入れる。
6. normalization変更はversionを上げ、以前のfailed結果を新しく実行せずpassedへ再分類しない。

### 9. 実装PRと完了条件

1. #8取り込みと#6残存指摘の再現・修正を先行する。
2. versioned evidence schema/required observation policyとCLI表示を追加する。
3. 2つの既存PR stackを同一HEADで全回帰し、compiled artifactのsource SHAを照合する。
4. Node-less/native ingress/app/release laneを各実装の完成に合わせて追加する。
5. branch/OS/profileを跨ぐevidence誤用を負例で拒否する。

完了はinvalid/missing/stale evidenceからverifiedが生成されないこと、各laneが実行対象と未実行を機械可読に出すこと、同じsourceから第三者が主要結果を再生できること。CI greenだけで0001のA-Jを閉じない。

## 受け入れ条件

- [ ] Given 7 candidates の `observed:{}`、when validator を実行、then problems が 1 件以上となり、probe 実行 command は無効 report を exit 1 で記録する。
- [ ] Given 正しく実測された負の値と理由付き NOT_RUN、when schema を検査、then missing と区別して raw 値・coverage を保存し、required gate は未完了のままとなる。
- [ ] Given observed field が missing/null/wrong-type、when candidate 固有 schema を評価、then 許容 variant 以外を field path 付きで拒否し、coverage を自己申告のまま信じない。
- [ ] Given aborted/wrong-version/wrong-hash baseline、when differential を開始、then candidate side effect の sentinel が作られず、exit 1、temporary output report が未作成となる。
- [ ] Given valid baseline と未実装 candidate、when differential が完了、then exit 0 と diverged/compatible:false が共存し、scope の異なる compatibility 表示をしない。
- [ ] Given 元 preload 未実行の adapted evidence、when strict profile へ admission、then profile/hash/observation variant の不一致として拒否する。
- [ ] Given native sender が synthetic / 環境が Linux portability、when verdict を集約、then native WebView / real-app の verified 行を増やさない。
- [ ] Given 重複 marker・crash 後 marker・source drift・古い compiled core、when evidence を採用、then invalid/failed を返し raw report と新しい診断を保持する。

## テスト計画

### 最小再現と既存 command

まず Node だけで次を実行し、欠陥の再現と既存 positive の不足を確認する。これは native 実行ではない。

```sh
node --test tests/macos-probe-validation.test.cjs
```

```sh
node <<'NODE'
const { validateReport, schemas } = require('./scripts/macos-probe.cjs');
const names = schemas.wksyncbridge.itemNames;
const report = {
  probe: 'wksyncbridge', status: 'PASS', compatibilityGate: 'OPEN',
  contextBridge: 'NOT_IMPLEMENTED', verdict: 'NO_PUBLIC_SYNC_PROXY',
  coverage: { candidates: 7, asExpected: 7, unexpected: 0, notExecuted: 0 },
  candidates: Object.fromEntries(names.map(name => [name, {
    attempted: true, executed: true, synchronousChannel: false,
    contextBridgeCompatible: false, outcome: 'as-expected',
    expectation: 'missing semantic observation must be rejected', observed: {},
  }])),
};
const result = validateReport('wksyncbridge', report);
const rejected = result.problems.length > 0;
console.log(JSON.stringify({ assertion: rejected ? 'PASS' : 'FAIL', result }));
process.exitCode = rejected ? 0 : 1;
NODE
```

既存 test は 2026-10-17 polish で PASS / exit 0、file-level 1 pass を再確認。上の反証の過去実施は FAIL / exit 1 / problems 空で、0005 に保存済み。修正後の PASS はまだ未実行。

core/saved-baseline の変更後は pin 済み toolchain で次を実行する。current fixture が必要とする compiled core を先に build し、production の `evidence/differential.json` を単体テストの出力先にしない。

```sh
moon test --target js
moon test --target native
node scripts/build-core.cjs
node --test tests/differential.test.cjs tests/manifest.test.cjs
```

macOS GUI の actual lane は `node scripts/macos-probe.cjs --build-only` と実実行を分離する。clipboard 修正後、disposable 環境の opt-out、`ELECTRON_MBT_OS_PASTE_OPT_IN=1 node scripts/macos-probe.cjs` の順に検証する。固定 Electron は `node scripts/oracle.cjs /absolute/path/to/Electron.app/Contents/MacOS/Electron` へ渡し、その後 `node scripts/differential.cjs --baseline evidence/electron-baseline.json --output evidence/differential.json` を実行する。これらの native/core/integration 実行は今回未実行。

新規 schema test command は `node --test tests/evidence-admission.test.cjs` を実装 PR で追加する案で、現 main には存在しない。toolchain・oracle・GUI がない場合は不足を明記して NOT_RUN とし、portable な最初の修正作業は進める。

### 6. CI laneと実行順

| lane | 実行環境 | gate |
| --- | --- | --- |
| docs/schema | portable | local links、schema、matrix/task整合 |
| pure MoonBit | pinned JS/native | lifecycle/IDs/limits/codec policy |
| Node-backed leaves | Node固定Linux/macOS | 現行loader/transport/kernel regression |
| QuickJS native | Linux contract＋macOS native | ABI/roots/modules/jobs/broker、Node不要 |
| macOS WebView | Apple Silicon、WindowServer | actual world/preload/ingress/window/fault |
| Electron oracle | isolated pinned environment | valid baseline、same fixture source |
| app scenarios | disposable macOS user/data | Moji M1-M3と再起動、jmd negative |
| interaction | interactive machine | IME/VoiceOver/focus/DPIの実操作 |
| packaging | clean target OS | Node-lessはno Node/Chromium、Node-backedは固定Nodeの同梱・容量・更新責任とChromium非同梱を検査。各profileのsigning、install/update/rollbackを独立に受入 |

CI短縮は独立compile/lintをparallel、同一sourceのcompiled-coreをartifact共有する方式を使う。現在macOS jobがLinux core artifactに依存する理由を保ち、artifact待ちを消すならmacOSが同じpinでnative/JS coreをbuildする設計へ置換する。異なるHEADのartifactをreuseしない。

合格を得るためのskip追加、timeout延長、assert削除を最初の対処にしない。失敗がenvironment/semantic/harnessのどれかを証跡で分類する。

### 7. ローカルとCIで同じ試験入口

既存commandは `moon check --target js`、`moon test --target js`、`moon test --target native`、`npm run build`、`npm test`、`node scripts/macos-probe.cjs`、固定Electronを渡すoracle/differentialである。PR追加commandは0005のexact HEADを確認して使う。

Node-less/new native/app/releaseコマンドは各実装PRで追加し、同じentryをCIから呼ぶ。actrun等のwrapper導入で内容を分岐させない。build-only、fake-host、Linux portabilityをactual macOSと別reportにする。

### 8. 最小回帰セット

1. #8 baseline admission：failed/aborted oracle、wrong source/version、empty/missing semantic data。
2. #6 probe判定：observedがmissing/null/wrong type、未実行candidate、clipboard opt-inなし、NSNull。
3. #9 listener：登録/解除/例外/reentryとrenderer権限非付与。
4. #11/#12 handler：cancel後late result、undefined、one-shot不正request非消費。
5. #2/#10/#13 host：stale navigation、close取消、native loss、attestationとloadのrace。
6. Node-less：Node-free binary/process audit、CJS/ESM/TS区別、QuickJS JSValue解放。
7. apps：boot import閉包、guide readonly、settings、保存先分離、再起動bytes、jmd明示拒否。

## リスク

| Risk | 抑止と再開条件 | Owner role |
| --- | --- | --- |
| required field を強化して実測 null/negative を誤拒否 | producer の variant と golden report を照合。positive/negative/NOT_RUN を別 fixture で再確認 | Evidence / Native |
| v2 の default/migration が古い欠損を成功にする | historical reader と gate admission を分離し、旧 report の raw 値を保存 | Core / Evidence |
| CI exit 0 を semantic PASS と解釈 | exit / harness / semantic / scope を明示した assertion と表示を用意 | CLI / QA |
| wrapper や別 artifact により source/HEAD がずれる | compiled artifact・fixture・driver の hash を同じ run へ束縛 | Integration / Build |

#6 の clipboard / NSNull 残件は source 確認であり、今回実 macOS 副作用を再現したとはしない。

## 変更履歴

- 2026-10-17: oracle の 3 lane、evidence bundle、admission 順序、CI・比較器設計を作成。
- 2026-10-17 polish: 11 セクションへ再編し、producer 別 required observations、最初の差分、入出力・エラー、Given/when/then、実在 command と新規 command 案、開始可能な範囲を追加。既存 pins・全回帰項目は保持。

## 注記

**準備状態:** missing observation の反証・schema/validator 修正と PR #8 の再利用は着手可能。始めるための追加の製品判断はない。source/API の型を読みながら行う実装判断は、この issue の受入基準に従う。macOS 実行と新規 lane は環境・依存成果物が揃ってから実施し、その不足で portable 修正の着手を止めない。

Status は既存 open-only 運用、指定された `issues/open`、AGENTS の runtime 受入方針に合わせて open を維持する。文書の整備と runtime gate 完了を同一視せず、移動・状態遷移は行っていない。Branch は提案名。common issue CLI と全体リンク検証は本 polish の全ファイルを揃えた後に行う。

### 10. 出典

1. [main workflow](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/.github/workflows/ci.yml)
2. [main manifest](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/compatibility/manifest.json)
3. [PR #5](https://github.com/f4ah6o/electron.mbt/pull/5)、[PR #6 review](https://github.com/f4ah6o/electron.mbt/pull/6#issuecomment-6136804622)、[PR #8](https://github.com/f4ah6o/electron.mbt/pull/8)
4. app固定source/lockfileの出典は [0014](0014-real-app-acceptance.md)。
