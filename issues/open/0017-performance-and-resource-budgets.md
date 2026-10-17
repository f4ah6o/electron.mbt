# 0017: 軽量化・応答性・資源budgetの測定設計

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / 未測定。下記の数値は提案budgetまたは既存設計目標 |
| 優先度 | P1。baseline収集はP0と並行可能 |
| 依存 | [0014 apps](0014-real-app-acceptance.md)、[0015 evidence](0015-oracle-ci-and-evidence.md)、[0016 pack](0016-packaging-release-and-updates.md) |
| 既存 | Issue 0001 §12。サイズ削減の実績はまだない |

## 1. 比較対象を固定する

同じapp commit、renderer assets、操作scenario、CPU、OS、release最適化、圧縮方式、入力dataを使う。Electron reference、Node-backed候補、QuickJS Node-less候補を別seriesとして保存する。adapted機能差がある場合はその差を一覧化し、同一機能比較と主張しない。

QuickJSの配布元が示す単体engineサイズから、製品bundleのサイズを推定して成果としない。renderer assets、production依存、native host、OS runtime、更新器を実際に含めて測る。

## 2. 測定する量

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

## 3. 固定する実行方法

1. min fixtureとMoji実scenarioを分ける。empty windowのみの結果を実アプリの値に置き換えない。
2. baselineとcandidateを交互に実行し、OS/thermal/cacheの時間変動を記録する。
3. warmは提案20回、coldはcache状態を再現可能な方法で提案10回測る。回数変更は事前記録する。
4. median/p95/min/maxとraw sampleを保存する。少数cold sampleのp95精度限界を示す。
5. update/download、initial indexing、first-run migration、steady stateを混ぜない。
6. instrumentationのon/offでoverheadを測り、常時計測による負荷を別欄にする。
7. failure/timeoutを測定結果から消さず失敗率へ計上する。

cacheを「coldにしたつもり」とせず、VM snapshot/OS再起動等の実際の方法を記録する。再現できないcoldはunknown/approximateと表示する。

### 3.1 文書サイズとIPC上限

1 MiBのfileが1 MiBのmessageへ収まるとは限らない。JSON escaping、UTF-8、envelope、schema tagsを含む **実際のencoded wire bytes** で上限を判定する。標準positive fixtureはASCII・日本語・escape-heavyごとにraw bytes/hashを固定し、対象codecでenvelope込みの上限以下であることを生成時に確かめる。100,000 bytesのfixtureと、上限に収まる最大近傍fixtureを別に測る。

1,000,000 bytesや1,048,576 bytesの文書は結果を先に成功扱いせず、wire sizeが超える場合は明示したquota-negativeとして測定する。上限超過を文字切捨や暗黙chunkingで通さない。大文書をpositiveに昇格するのは0010のbounded streamまたは別の明示転送方式が受入を通ってからとし、従来IPCとの機能差を残す。

## 4. 受入budget案

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

## 5. engine・queueのprofiling

QuickJSでeval、module parse、job drain、GC、callback、encode/decodeを別spanへ分ける。MoonBit coreではdispatch、policy、queue wait、native ACKを測る。WebViewではnavigation、DOM ready、paint/interactiveを区別する。

1. 無限microtask、長い同期JS、巨大JSON、many small IPC、never-settling promisesを注入する。
2. CPU割当/interruption、1MiB payload、4MiB queue等の上限がworkloadにどう効くかを測る。
3. repeated navigationでold root/listener/pendingが解放されることをcounterで確かめる。
4. hotpath.mbt等を採用するなら出力をartifactへ保存し、計測ツール導入だけで改善扱いしない。
5. engine最適化前に最も遅いspanと実app影響を確認し、機能を削って速くした場合はadaptationへ記録する。

## 6. 分割PRと完了

1. measurement schema/runnerとElectron baseline収集。
2. candidate release artifactのinventory/size計測。
3. 全processとresource ownerの計測。
4. real-app startup/open/save/soak比較。
5. evidenceのsummary生成とregression gate。

完了はraw result、environment、artifact hash、機能差分、再現手順が揃うこと。目標未達なら未達と記録して原因別issueを作り、数値を削除してgateを通さない。

## 7. 出典

1. [Issue 0001軽量化設計](0001-electron-compatible-lightweight-runtime.md)
2. [PR #3 Node-free artifact audit](https://github.com/f4ah6o/electron.mbt/pull/3)
3. [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) — system runtime導入依存の扱い。
