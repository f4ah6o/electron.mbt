# 0017: 軽量化・応答性・資源budgetの測定設計

Status: open
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: impl/0017-measurement-schema-runner

## 概要

軽量化・起動・操作応答・memory/process/resource を同条件で測り、測定できた範囲と未帰属/失敗を残す実装・測定 issue。初回は measurement schema と統計集計器を作り、artifact がない段階でも fixture による正しさを検証できる。

| 分類 | 決定 |
| --- | --- |
| 性質 | 測定基盤の実装＋固定 baseline/candidate の比較実験 |
| 優先度 | P1、baseline 条件の確定と収集は P0 作業と並行可 |
| 利用者に見える影響 | 初回取得量、起動して入力できるまでの待ち時間、編集・保存・長時間利用の実負荷を判断できる |
| 初回 branch | `impl/0017-measurement-schema-runner`（提案、未作成） |
| 最初の成果物 | raw samples、identity/units/schema、deterministic summary。性能改善の達成は別判定 |

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / 未測定。下記の数値は提案budgetまたは既存設計目標 |
| 優先度 | P1。baseline収集はP0と並行可能 |
| 依存 | [0014 apps](0014-real-app-acceptance.md)、[0015 evidence](0015-oracle-ci-and-evidence.md)、[0016 pack](0016-packaging-release-and-updates.md) |
| 既存 | Issue 0001 §12。サイズ削減の実績はまだない |

## 背景

### 1. 比較対象を固定する

同じapp commit、renderer assets、操作scenario、CPU、OS、release最適化、圧縮方式、入力dataを使う。Electron reference、Node-backed候補、QuickJS Node-less候補を別seriesとして保存する。adapted機能差がある場合はその差を一覧化し、同一機能比較と主張しない。

QuickJSの配布元が示す単体engineサイズから、製品bundleのサイズを推定して成果としない。renderer assets、production依存、native host、OS runtime、更新器を実際に含めて測る。

現 `app-files.cjs::snapshot` は source file の `bytes / sha256 / totalBytes` を返す bounded inventory であり、圧縮配布量・installed allocation・process memory・startup は計測しない。現 `scripts/oracle.cjs` は core fixture の trace を採り、performance harness ではない。[inventory source](https://github.com/f4ah6o/electron.mbt/blob/8177cf051976b8d7b9eca25ae7ad8820bb04a719/bridges/node/app-files.cjs)、[oracle source](https://github.com/f4ah6o/electron.mbt/blob/8177cf051976b8d7b9eca25ae7ad8820bb04a719/scripts/oracle.cjs)

## 問題

1. engine 単体の size や empty window の速度から、実 app の配布量・体感性能を推定できない。
2. source/profile/OS/機能差、cold/warm、初期 migration、計測 overhead を固定しなければ比較値に意味がない。
3. OS が所有する WebContent/GPU/network process を計上できない場合や shared memory の RSS 合算では、全体 footprint を過大・過小に見せ得る。
4. raw 1 MiB 文書は JSON escaping/envelope を含む 1 MiB message 上限に収まるとは限らない。失敗を落とすと大文書の制約を隠す。
5. 提案閾値はまだ実 app baseline に照合されておらず、結果を見て後付け変更すると受入基準が動く。

## 目標

1. 同じ app/profile/fixture/OS/CPU/release 条件について raw samples と summary を再生成できる。
2. visible / interactive / open/save / cleanup の endpoint と clock domain、bytes/memory の単位を明示する。
3. failures/timeouts/unknown attribution を分母と report に残し、有限な resource 使用と回収を owner ledger で照合する。
4. 閾値を測定前に固定し、未達も原因・データを残す。性能測定と機能/安全性の gate を交換しない。

## 対象外

- 実測前の size/RSS/startup 改善保証、単体 QuickJS benchmark の製品値への転記。
- Node-backed / adapted / strict の機能差を無視した同機能比較、共有 OS process の強制終了による見かけの改善。
- 未実装 streaming を暗黙に使って quota を超える文書を成功させること。
- 本 issue のために engine を再選定すること、署名・pack・native app の本体実装、恒常 telemetry の無断収集。

## 提案する方針

### 最初の bounded slice: schema と集計器

1. 新規予定 `compatibility/measurement-schema-v1.json`、`scripts/measure/summarize.cjs`、`tests/measurement-summary.test.cjs` を作る。最初の PR は raw sample の検証と deterministic summary に限定する。
2. 入力は experiment ID、candidate/oracle/artifact/profile hashes、環境、metric/units、scenario、attempt、cold/warm、source clock、result status を持つ JSONL。提案上限は 10,000 samples・1 line 64 KiB・total 64 MiB とし、境界 fixture で実装する。これは measurement file の入力上限であり IPC quota を変更しない。
3. 出力は raw digest、completed/failed/timeout/unknown の件数、成功 sample の min/max/median/p95、失敗率、除外理由、missing required metrics。分母は全 attempt とし、`failureRate=(failed+timeout)/attempts`、`unknownRate=unknown/attempts`、`nonSuccessRate=(failed+timeout+unknown)/attempts` を併記する。attempt が 0 なら各率は null、completed が 0 なら統計値は null とし、0 ms や成功に変えない。unknown を成功扱いして比較 gate を閉じない。
4. 最初の統計定義案は median=中央 1 値または中央 2 値の平均、p95=sort 後の `ceil(0.95*n)` 番目。n=10 の cold p95 は最大値に相当するため、少数標本の限界を表示する。手法変更は schema/normalization revision を上げる。
5. malformed/nonfinite/negative duration、duplicate attempt、unit/profile/clock mismatch は集計前に非零 exit + reason とし、入力を変更しない。欠損 metric は unknown、異なる workload を自動平均しない。

| 既存 / 新規予定 | Path / 責務 | 接続する時期 |
| --- | --- | --- |
| 既存 | `bridges/node/app-files.cjs` / `tests/loader.test.cjs` | source integrity の参考。artifact/process 測定と別 fields |
| 既存 | `scripts/oracle.cjs` / `scripts/differential.cjs` / 0015 evidence | app/source/profile/run の identity を合わせる。現 command に未実装 metric があるとは扱わない |
| 新規予定 | `compatibility/measurement-schema-v1.json` / `scripts/measure/summarize.cjs` | 最初の schema/negative/statistics PR |
| 新規予定 | `scripts/measure/collect.cjs` / native measurement leaf | actual release artifact / clean OS / app fixture が揃ってから収集。native PID attribution と clock を確認 |
| 新規予定 | `tests/measurement-summary.test.cjs` / `fixtures/measurements/` | synthetic samples の unit と実験 evidence を混ぜない |
| 生成物案 | `evidence/measurements/<experiment-id>/` | immutable raw samples、environment、artifact manifest、summary、失敗ログ |

異なる process の `performance.now()` をそのまま引き算しない。全 elapsed を同じ collector の monotonic clock で記録するか、native event の clock domain と校正を明示する。host の受信時刻を使う場合は「event を受信するまで」の測定であり、実 paint/composition の瞬間と同一視しない。endpoint の確定は Q-PERF-01 に従う。

### 2. 測定する量

| 項目 | 定義 | 測定条件 |
| --- | --- | --- |
| compressed bytes | 配布archive/installer実bytes | 同一圧縮、署名・更新metadataを含む |
| installed bytes | app＋新規依存の追加disk | APFS clone等の論理/実割当を区別 |
| first acquisition | app＋不足WebView等の全download | clean環境、既導入環境を別欄 |
| startup visible | launchからfirst visible frame | cold/warm、GUI session |
| startup interactive | launchから入力への有効応答 | 表示だけで完了にしない |
| scenario latency | open、固定bytesの小文書/大文書編集、save/readback | data hash・正確なbytes・wire encode後のbytesと同じ操作列 |
| memory | host/Main/WebContent/GPU/network等 | OSごとのprivate/footprint/PSSとRSSを区別 |
| CPU/energy | idle、編集中、長時間操作 | background activityと熱/電源条件を記録 |
| resource lifetime | FD/JS root/timer/listener/request/window | close/reload/crash後のbaseline復帰 |

shared browser/GPU processが直接子でない場合も観測する。帰属不能ならその範囲をunknownにし、分かるprocessだけの合計を全体memoryと表示しない。共有memoryをRSS加算で二重計上した指標だけで優劣を断定しない。

### 3. 固定する実行方法

1. min fixtureとMoji実scenarioを分ける。empty windowのみの結果を実アプリの値に置き換えない。
2. baselineとcandidateを交互に実行し、OS/thermal/cacheの時間変動を記録する。
3. warmは提案20回、coldはcache状態を再現可能な方法で提案10回測る。回数変更は事前記録する。
4. median/p95/min/maxとraw sampleを保存する。少数cold sampleのp95精度限界を示す。
5. update/download、initial indexing、first-run migration、steady stateを混ぜない。
6. instrumentationのon/offでoverheadを測り、常時計測による負荷を別欄にする。
7. failure/timeoutを測定結果から消さず失敗率へ計上する。

cacheを「coldにしたつもり」とせず、VM snapshot/OS再起動等の実際の方法を記録する。再現できないcoldはunknown/approximateと表示する。

#### 3.1 文書サイズとIPC上限

1 MiBのfileが1 MiBのmessageへ収まるとは限らない。JSON escaping、UTF-8、envelope、schema tagsを含む **実際のencoded wire bytes** で上限を判定する。標準positive fixtureはASCII・日本語・escape-heavyごとにraw bytes/hashを固定し、対象codecでenvelope込みの上限以下であることを生成時に確かめる。100,000 bytesのfixtureと、上限に収まる最大近傍fixtureを別に測る。

1,000,000 bytesや1,048,576 bytesの文書は結果を先に成功扱いせず、wire sizeが超える場合は明示したquota-negativeとして測定する。上限超過を文字切捨や暗黙chunkingで通さない。大文書をpositiveに昇格するのは0010のbounded streamまたは別の明示転送方式が受入を通ってからとし、従来IPCとの機能差を残す。

### 4. 受入budget案

これらは性能実績ではない。R0でbaselineを採り、対象hardwareと測定方法を確定した時点でADRに固定する。結果を見て閾値を緩める場合は旧結果と理由を残す。

| 指標 | 提案gate | 扱い |
| --- | --- | --- |
| 圧縮配布 | 同機能・同条件でElectronの50%以下 | Issue 0001の既存提案目標。Node-backedはNode含む |
| cold total取得 | candidateと不足依存を合計して表示 | app単体が小さくても逆転を明示 |
| startup p95 | reference比1.25倍以内を初期検討 | baseline後に確定。strict非同機能比較へ使わない |
| open/save latency | reference比1.25倍以内を初期検討 | disk/OS cacheの分散とセット |
| idle leak | repeated open/close後にbounded plateau | RSSだけでゼロleakと断定せずowner ledgerも照合 |
| input latency | 文字欠落・順序違反0、分布を記録 | 目標msは実display/input環境で設定 |
| data loss/privilege | 0件 | 性能改善で交換しないrelease blocker |
| exit cleanup | 所有process/FD/rootが回収 | OS共有processの未帰属は未検証 |

memoryが減る保証、起動が速くなる保証は置かない。最初の主仮説はappごとのChromium同梱を減らすことによる配布量削減である。QuickJS Main engineは同梱し、system WebView自体の取得・更新依存も費用へ含める。

### 5. engine・queueのprofiling

QuickJSでeval、module parse、job drain、GC、callback、encode/decodeを別spanへ分ける。MoonBit coreではdispatch、policy、queue wait、native ACKを測る。WebViewではnavigation、DOM ready、paint/interactiveを区別する。

1. 無限microtask、長い同期JS、巨大JSON、many small IPC、never-settling promisesを注入する。
2. CPU割当/interruption、1MiB payload、4MiB queue等の上限がworkloadにどう効くかを測る。
3. repeated navigationでold root/listener/pendingが解放されることをcounterで確かめる。
4. hotpath.mbt等を採用するなら出力をartifactへ保存し、計測ツール導入だけで改善扱いしない。
5. engine最適化前に最も遅いspanと実app影響を確認し、機能を削って速くした場合はadaptationへ記録する。

### 6. 分割PRと完了

1. measurement schema/runnerとElectron baseline収集。
2. candidate release artifactのinventory/size計測。
3. 全processとresource ownerの計測。
4. real-app startup/open/save/soak比較。
5. evidenceのsummary生成とregression gate。

完了はraw result、environment、artifact hash、機能差分、再現手順が揃うこと。目標未達なら未達と記録して原因別issueを作り、数値を削除してgateを通さない。

## 受け入れ条件

- [ ] Given 同じ有効 raw samples と schema、when summary を 2 回生成、then digest・件数・統計値が同一で元入力を変更しない。
- [ ] Given durations [10,20,30,40] ms、when 初期統計定義で集計、then median=25、p95=40、min=10、max=40、completed=4 となる。
- [ ] Given 成功 8 / timeout 1 / failed 1、when 集計、then 全 10 attempt と失敗率 20% を残し、成功分の統計と失敗を分離する。
- [ ] Given completed が 0 または required native metric が欠損、when verdict を作成、then 統計 null/unknown と未達 gate を出し、0 ms や improvement PASS を作らない。
- [ ] Given 異なる profile/units/clock、duplicate attempt、oversize JSONL、when admission、then reason 付きで拒否し都合よく混ぜない。
- [ ] Given 固定 Moji artifact/workload/OS、when cold/warm の提案回数で実行、then raw samples・機能差・署名込み bytes・実関連 process の帰属を保存する。
- [ ] Given 1,000,000 / 1,048,576 raw bytes 文書、when encode して IPC limit を評価、then actual wire bytes で positive/quota-negative を分類し切捨てや無断 chunking がない。
- [ ] Given open/close/reload/crash の反復、when quiescence 後に計測、then owned pending/root/FD/child を baseline と照合し、未帰属 shared process を全体回収済みとは表示しない。
- [ ] Given 確定 budget に未達、when report を公表、then 未達値と条件を残し、threshold を変更する場合は理由・旧結果・新 revision を保持する。

## テスト計画

### 最初の実装と実験を分ける

既存の source inventory は repository root で次を実行できる。

```sh
node cmd/electron-mbt.cjs snapshot fixtures/cjs
```

2026-10-17 polish で exit 0 / totalBytes 311 / 3 files を確認。これは min fixture の source bytes であり、製品 size・installed bytes・性能値ではない。

```sh
node --test tests/measurement-summary.test.cjs
```

この command は新規 unit file を実装した後の案で、今回は未実行。median の奇数/偶数、p95 の rank、全失敗、混合 status、unknown/NaN/Infinity/negative、limit 直前/超過、duplicate IDs、source/profile mismatch を small fixtures で確認する。CI の速度を測定結果として採用しない。

| 実験 lane | 最小の入力・操作 | 判定・今回 |
| --- | --- | --- |
| Artifact | 同じ app/機能の署名済み candidate/reference、同一圧縮、cold 依存込み | 実 bytes と source/artifact hash。未実行 |
| Startup | 固定環境で warm 20 / cold 10 を提案。交互順、launch/visible/interactive endpoint | median/p95/raw と失敗率、cold 手法。未実行 |
| File operation | 固定 ASCII/日本語/escape-heavy fixtures、open/edit/save/readback | raw/wire bytes、入力遅延、permission/quota 結果。未実行 |
| Resource/soak | 比較条件固定の repeated navigation/window/close、crash/restart | owner ledger と memory の plateau、FD/roots/child、未帰属範囲。未実行 |

実験 command の正確な options は collector を実装する PR で schema と同時に固定する。compile-only、developer build、別 CPU、empty window を実 app release の代わりにしない。実 app と clean target がない段階でも、最初の schema/summary unit の着手は可能。

## リスク

| Risk | 抑止・検出・再開条件 | Owner role |
| --- | --- | --- |
| endpoint/clock の不一致 | event の意味と collector clock を固定。first load と interactive を別 metric | Native / Performance |
| n が少ない p95・熱/cache の偏り | raw 順序、交互測定、cold 手法、n/失敗率を併記 | QA / Performance |
| shared process の欠落/二重加算 | OS ごとの帰属と footprint/PSS/RSS の違いを保持し unknown を表示 | Platform |
| 条件を変えて改善に見せる | profile/adaptation/fixture/artifact hashes、測定前 budget を保存 | Product / Evidence |
| workload が IPC 上限で失敗 | encode 後 bytes を測り negative と positive を区別 | IPC / App |

データ保護・権限違反を性能改善と交換しない。instrumentation 自体の CPU/memory overhead を on/off で確認する。

## 未解決の質問

| 質問 / 根拠 | Owner role | 着手可能 / 影響範囲 | 再開条件 |
| --- | --- | --- | --- |
| Q-PERF-01: 比較する hardware/OS、cold の再現手法、visible/interactive の実観測 endpoint は何か。native/pack artifact 未受入 | Performance / Native / QA | schema/summary と fixture は着手可。actual startup の比較 verdict は条件確定まで保留 | 同じ app/OS/CPU/artifact、clock/marker と取得方法、cold 手法を experiment manifest に固定 |
| Q-PERF-02: p95 比 1.25 等の提案閾値、input latency の目標、soak の反復回数/観測窓を何に確定するか。現 §4 は未測定の案 | Product / Performance | raw baseline の収集は可。release の性能合否に使う基準は採用前に決定 | baseline/variance と利用条件を示し 0021 DEC-09 で budget revision を固定、candidate 結果を見る前に承認範囲を記録 |

未測定であること自体を統計基盤の実装 blocker としない。既存の 50% 圧縮サイズ目標は削除せず、達成可能性と同機能比較条件を実験で判断する。

## 変更履歴

- 2026-10-17: 同条件比較、raw/wire bytes、cold/warm、全 process/resource、提案 budget の設計を作成。
- 2026-10-17 polish: 必須 11 セクションへ再構成。最初の schema/summary PR、明確な statistics/limits/error、Given/when/then、既存 inventory と performance の違い、測定条件を決める質問を追加。元の数値目標と全測定項目を保持。

## 注記

**準備状態:** measurement schema、deterministic summary、反証 fixtures に着手可能。Q-PERF-01 は実計測条件、Q-PERF-02 は合否閾値の決定であり、最初の実装や条件収集を停止する理由ではない。actual release artifact/実機がない範囲の性能試験は NOT_RUN のまま。

Status は指定の `issues/open`、既存 open-only と runtime 実受入まで open を維持する AGENTS 方針に合わせる。保留前・再開先とも本 file の open、理由と影響は上表。Branch は提案で、性能実装が既に存在する意味ではない。

### 7. 出典

1. [Issue 0001軽量化設計](0001-electron-compatible-lightweight-runtime.md)
2. [PR #3 Node-free artifact audit](https://github.com/f4ah6o/electron.mbt/pull/3)
3. [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) — system runtime導入依存の扱い。
