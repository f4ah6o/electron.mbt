# 0005: 既存 Issue・PR の棚卸しと実装統合設計

Status: open
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: impl/0005-existing-work-integration

## 概要

既存成果を失わずに二つの PR stack を統合する実装・レビュー issue。最初の変更は証跡検証の既知欠陥を再現し、PR #8 の baseline admission を再利用できる候補にする。統合作業を実装せず文書だけ追加した段階では、利用者の run / pack や互換表示を変えない。

| 分類 | 決定 |
| --- | --- |
| 性質 | 既存 PR の統合・回帰防止・review。新規 runtime 全体の再実装ではない |
| 優先度 | P0: INT-01/02 の証跡・既知欠陥、P1: INT-03〜06 の統合 |
| 利用者への影響 | 既存修正の消失と false PASS を防ぎ、将来の native/IPC を同じ契約へ接続する |
| 初回 branch | 上記 Branch は新しい統合候補の提案名。元 PR branch を書き換えない |
| 完了の単位 | INT-01〜06 の候補・証跡・未達対応表。製品全体の完了は 0004 |

Document-ID: electron-readiness-0005
Owner: 統合担当（実装着手時に割り当て）
Depends-on: [0004 実用化ロードマップ](0004-production-readiness-roadmap.md)
Related: [0006 アーキテクチャ・profile](0006-runtime-architecture-and-profiles.md)、[0015 Oracle・CI・証拠](0015-oracle-ci-and-evidence.md)

### 1. 状態・目的・証拠の読み方

1. **棚卸しは completed、以下の統合作業は planned / 未実行。** 本文の基準時刻は 2026-10-17 14:20 JST（05:20 UTC）。実装 PR のレビュー・競合解消・マージを本書の作成で完了扱いにしない。
2. 調査基点は [main `30c6fc97186e7ecfc8397c799525f00c8e4f0f65`](https://github.com/f4ah6o/electron.mbt/commit/30c6fc97186e7ecfc8397c799525f00c8e4f0f65)、tree `868721c27e18205827bfd735de7a535b9fce9dc0`。本書を追加した後の main は別 SHA となる。
3. [PR collection](https://api.github.com/repos/f4ah6o/electron.mbt/pulls?state=all&per_page=100) で **全13件、open/Draft 8件、merged 5件**を確認した。検索 API は PR:3 と merged PR:4〜7 を返さなかったため、全件判定には collection を使用した。
4. [Issues collection](https://api.github.com/repos/f4ah6o/electron.mbt/issues?state=all&per_page=100) は全件 PR。通常の GitHub Issues は **0件**、repository metadata は `has_issues:false`。main の `issues/open` は [0001](0001-electron-compatible-lightweight-runtime.md) の1文書のみだった。
5. **直接確認**は GitHub API の状態・HEAD・run/job/stepと取得した生ログ、**報告**は PR 本文・レビューの作者記載、**未実行**はこの調査で実行していない試験を指す。CI artifact ZIP の再ダウンロード・digest照合は今回未実行。
6. main、open PR、診断 probe、実 Electron reference、synthetic trusted-host candidate、実 renderer candidate を別の実装・証拠単位にする。現行 `compatible:false`、通常 `run` / `pack` の fail-closed、未達 gate を既存 CI green だけで解除しない。
7. 本書の目的は既存成果の再実装を防ぎ、修正・統合・後続実装を特定すること。原本 0001 の M0〜M4 / A〜J、PR:2 の native scope、PR:3 の N0〜N6 / JS・TS受入を保全し、未達範囲を消さない。

## 背景

既存 CI は取得時点の PR HEAD に紐付く。今回の polish の入力は main [`8177cf051976b8d7b9eca25ae7ad8820bb04a719`](https://github.com/f4ah6o/electron.mbt/commit/8177cf051976b8d7b9eca25ae7ad8820bb04a719) の文書・実装であり、以下の旧 snapshot を新しい CI 結果へ読み替えない。旧 main 1 文書という記述は最初の調査時点を表す。polish 対象は現在 `issues/open` の 19 文書である。

### 2. 全 PR の基点台帳

#### 2.1 状態・HEAD・base branch

SHA は取得した PR metadata の値。特に PR:2 / PR:3 の base SHA は古い main を指す。現在の main を base SHA として補正・上書きしない。

| PR | 状態 | HEAD SHA | Base branch |
| --- | --- | --- | --- |
| [PR:1](https://github.com/f4ah6o/electron.mbt/pull/1) | merged / 非Draft | `5fb83ef06f191e27c01db4cb3516498243e79ebd` | `main` |
| [PR:2](https://github.com/f4ah6o/electron.mbt/pull/2) | open / Draft | `bdc5886da0483da2b8dbecba21f95556b9263c6b` | `main` |
| [PR:3](https://github.com/f4ah6o/electron.mbt/pull/3) | open / Draft | `49ec04fac8f1db7212f98ade5a82128f1c4692e5` | `main` |
| [PR:4](https://github.com/f4ah6o/electron.mbt/pull/4) | merged / 非Draft | `921677987efcd7c6cf7bed3ed337c92378750dff` | `main` |
| [PR:5](https://github.com/f4ah6o/electron.mbt/pull/5) | merged / 非Draft | `f46f3b2774fdfd1775d1ece0f46ae0e19b4a9ad8` | `main` |
| [PR:6](https://github.com/f4ah6o/electron.mbt/pull/6) | merged / 非Draft | `51d7b935040d32c822f10f03e58cc1fa634ce83e` | `impl/0001-oracle-differential` |
| [PR:7](https://github.com/f4ah6o/electron.mbt/pull/7) | merged / 非Draft | `646459533e8bb5a1bbbd1d0beca4881f362a3f5f` | `main` |
| [PR:8](https://github.com/f4ah6o/electron.mbt/pull/8) | open / Draft | `13087530502e3944b88fef8854c3123a3cdf90d8` | `main` |
| [PR:9](https://github.com/f4ah6o/electron.mbt/pull/9) | open / Draft | `b13f9f49ca35a58b30e6267b3b5de36755680f07` | `feat/m0-baseline-admission` |
| [PR:10](https://github.com/f4ah6o/electron.mbt/pull/10) | open / Draft | `8f006f94c9ce580f5705af60f3402f49779d85cc` | `feat/m1-native-host-contract` |
| [PR:11](https://github.com/f4ah6o/electron.mbt/pull/11) | open / Draft | `94736f0204fd19527f0c6041e1c2019e0f3b595d` | `feat/ipc-main-listeners` |
| [PR:12](https://github.com/f4ah6o/electron.mbt/pull/12) | open / Draft | `95c9a3457de3f8b8641232e4ba1d29a273ba6fe0` | `feat/ipc-invoke-kernel` |
| [PR:13](https://github.com/f4ah6o/electron.mbt/pull/13) | open / Draft | `9d73ebc6d6389f431f6664ae9f6acacf3fe30599` | `impl/contextbridge-handle-lifetime-20261017` |

#### 2.2 Base SHA と merged commit

| PR | PR metadata の base SHA | merge commit | merged_at UTC |
| --- | --- | --- | --- |
| PR:1 | `f2411606e4e1dd5c9504ca4fee562c2e5898c953` | `b6024735bfd5e3d946614295371bc13ff1527397` | 2026-10-09T22:58:41Z |
| PR:2 | `b6024735bfd5e3d946614295371bc13ff1527397` | — | — |
| PR:3 | `b6024735bfd5e3d946614295371bc13ff1527397` | — | — |
| PR:4 | `b6024735bfd5e3d946614295371bc13ff1527397` | `9ab53a5cc94c914835f97918157f0d0cb90d0932` | 2026-10-11T14:51:45Z |
| PR:5 | `9ab53a5cc94c914835f97918157f0d0cb90d0932` | `072181ed9990e333634512925c82ce709a045dd8` | 2026-10-13T02:19:18Z |
| PR:6 | `45a653c46557ba71c436cc5a588369e819dea870` | `f46f3b2774fdfd1775d1ece0f46ae0e19b4a9ad8` | 2026-10-13T02:17:41Z |
| PR:7 | `072181ed9990e333634512925c82ce709a045dd8` | `30c6fc97186e7ecfc8397c799525f00c8e4f0f65` | 2026-10-13T02:24:34Z |
| PR:8 | `30c6fc97186e7ecfc8397c799525f00c8e4f0f65` | — | — |
| PR:9 | `13087530502e3944b88fef8854c3123a3cdf90d8` | — | — |
| PR:10 | `bdc5886da0483da2b8dbecba21f95556b9263c6b` | — | — |
| PR:11 | `b13f9f49ca35a58b30e6267b3b5de36755680f07` | — | — |
| PR:12 | `94736f0204fd19527f0c6041e1c2019e0f3b595d` | — | — |
| PR:13 | `8f006f94c9ce580f5705af60f3402f49779d85cc` | — | — |

PR:6 は PR:5 の branch に先に merge され、その merge commit `f46f3b27...` が PR:5 の最終 HEAD になった。PR:6 を独立の未統合機能として再追加しない。
直接確認した mergeable は PR:2 **false**、残る open 7件 **true**。mergeable は構文上の統合可否であり、承認・相互動作・本番適合の判定ではない。

#### 2.3 HEAD に一致する CI

全行で run 自体の `event:pull_request` と `head_sha` 一致を直接確認。下表はその時点の成功であり、新 main との統合結果ではない。

| PR | CI run | status / conclusion | run updated_at UTC | 今回の確認深度 |
| --- | --- | --- | --- | --- |
| PR:1 | [38001868153](https://github.com/f4ah6o/electron.mbt/actions/runs/38001868153) | completed / success | 2026-10-09T22:57:16Z | run・HEAD一致 |
| PR:2 | [38119303153](https://github.com/f4ah6o/electron.mbt/actions/runs/38119303153) | completed / success | 2026-10-11T06:51:10Z | run・job・step・生ログ |
| PR:3 | [38145437280](https://github.com/f4ah6o/electron.mbt/actions/runs/38145437280) | completed / success | 2026-10-11T14:01:54Z | run・job・step・生ログ |
| PR:4 | [38148631185](https://github.com/f4ah6o/electron.mbt/actions/runs/38148631185) | completed / success | 2026-10-11T14:49:02Z | run・HEAD一致 |
| PR:5 | [38336200589](https://github.com/f4ah6o/electron.mbt/actions/runs/38336200589) | completed / success | 2026-10-13T02:19:31Z | run・HEAD一致 |
| PR:6 | [38335053007](https://github.com/f4ah6o/electron.mbt/actions/runs/38335053007) | completed / success | 2026-10-13T02:04:56Z | run・HEAD一致 |
| PR:7 | [38336434932](https://github.com/f4ah6o/electron.mbt/actions/runs/38336434932) | completed / success | 2026-10-13T02:22:18Z | run・HEAD一致 |
| PR:8 | [38921185445](https://github.com/f4ah6o/electron.mbt/actions/runs/38921185445) | completed / success | 2026-10-16T15:07:55Z | run・job・step・生ログ |
| PR:9 | [38926365211](https://github.com/f4ah6o/electron.mbt/actions/runs/38926365211) | completed / success | 2026-10-16T15:46:01Z | run・job・step・生ログ |
| PR:10 | [38979817327](https://github.com/f4ah6o/electron.mbt/actions/runs/38979817327) | completed / success | 2026-10-16T23:10:46Z | run・job・step・生ログ |
| PR:11 | [38931231928](https://github.com/f4ah6o/electron.mbt/actions/runs/38931231928) | completed / success | 2026-10-16T16:22:25Z | run・job・step・生ログ |
| PR:12 | [38976883189](https://github.com/f4ah6o/electron.mbt/actions/runs/38976883189) | completed / success | 2026-10-16T22:39:22Z | run・job・step・生ログ |
| PR:13 | [38980832906](https://github.com/f4ah6o/electron.mbt/actions/runs/38980832906) | completed / success | 2026-10-16T23:21:22Z | run・job・step・生ログ |

open 8件では Linux `moonbit` / macOS `macos` の両 job、および取得できた全 step が completed/success。merged 5件では run 状態まで確認し、テスト生ログは今回再取得していない。
PR:13 本文は push run `38980829280` を参照するが、本台帳は同 HEAD の PR run `38980832906` を参照する。run ID・artifact を取り違えない。

#### 2.4 open PR の生ログで直接確認した件数

| PR | MoonBit JS / native | Node Linux | Node macOS | 成立している試験範囲 |
| --- | --- | --- | --- | --- |
| PR:2 | 各 PASS 38/38 | PASS 111 / FAIL 0 / SKIP 0 | PASS 111 / FAIL 0 / SKIP 0 | native host / navigation lifetime、旧 base との組合せ |
| PR:3 | 各 PASS 15/15 | PASS 32 / FAIL 0 / SKIP 0 | PASS 32 / FAIL 0 / SKIP 0 | Node版既存基盤。QuickJS 実装試験なし |
| PR:8 | 各 PASS 28/28 | PASS 110 / FAIL 0 / SKIP 0 | PASS 110 / FAIL 0 / SKIP 0 | baseline admission。full differential は非互換を記録 |
| PR:9 | 各 PASS 37/37 | PASS 151 / FAIL 0 / SKIP 0 | PASS 151 / FAIL 0 / SKIP 0 | main-local listener contract |
| PR:10 | 各 PASS 62/62 | PASS 136 / FAIL 0 / SKIP 3 | PASS 139 / FAIL 0 / SKIP 0 | host-local lifetime / native bootstrap / restricted preload |
| PR:11 | 各 PASS 49/49 | PASS 180 / FAIL 0 / SKIP 0 | PASS 180 / FAIL 0 / SKIP 0 | invoke kernel、candidate は synthetic host |
| PR:12 | 各 PASS 49/49 | PASS 214 / FAIL 0 / SKIP 0 | PASS 214 / FAIL 0 / SKIP 0 | invoke undefined / revoked reply、同じ synthetic-host 境界 |
| PR:13 | 各 PASS 63/63 | PASS 137 / FAIL 0 / SKIP 3 | PASS 140 / FAIL 0 / SKIP 0 | isolated native event one-shot / failed preload deny |

1. PR:10 / PR:13 の macOS 生ログは bootstrap handler の preload からの不可視、page から両 handler の不可視、native checksum改ざん拒否、same-URL reload失効を記録する。PR:13 は `nativeAttestationEventOneShot:true` / `failedPreloadNeverAttested:true` も記録する。任意 page initiator の認証済 IPC を意味しない。
2. PR:11/12 の本文は reference に実 Electron renderer IPC、candidate に production invoke kernel + synthetic trusted-host metadata を使用したと明記。16 scenario の局所同値を candidate renderer E2E / unchanged app 同値へ拡張しない。
3. PR:3 の静的文書検証 PASS、PR:2 最新増分の独立モデルレビュー、各 PR の artifact digest 検査は**作者報告**。今回の独立実施として表示しない。作者の古いテスト件数と新しい CI ログを混ぜない。

### 4. 既存 issue ID とレビュー状態

#### 4.1 文書ID・alias

| stable document_id の提案 | 既存ファイル・別名 | 所在 |
| --- | --- | --- |
| `electron-runtime-root` | `0001-electron-compatible-lightweight-runtime.md` / `ISSUE:0001` | main |
| `electron-node-native-host` | `0002-m1-native-host-contract.md` / `ISSUE:0002-native-host` | PR:2 |
| `electron-nodeless-roadmap` | `0002-node-less-electron-compatible-moonbit-roadmap.md` / `ISSUE:0002-nodeless` | PR:3 |
| `electron-nodeless-js-ts` | `0003-nodeless-existing-js-ts-runtime.md` / `ISSUE:0003` | PR:3 |
| `electron-readiness-0004`〜`electron-readiness-0021` | 新実用化計画 | 本計画 |

1. `0002` は別ファイルで重複している。既存filename・原本の見出し・履歴を保ち、document_idとaliasで区別する。数値 `0002` だけで参照しない。
2. GitHub PRは `PR:2`、local issueは `ISSUE:0002-native-host` のようにnamespaceを分ける。旧リンクの移行先を台帳に残す。既存ファイルを一方へ上書きしない。
3. PR:8〜13は新規local issueを含まない。§3.4のdocsとPRを既存作業のownerとして扱い、同じkernel/loader/validatorを新issueで再実装しない。

#### 4.2 GitHub上の未解決と実装上の残存を分離

1. PR:2は inline **34 threads、11 resolved、23 unresolved**。unresolved 23件は全件 `is_outdated:true`、current unresolvedは0。**outdatedは解決済を意味しない。** 現HEADの欠陥23件とも断定しない。
2. 古い指摘群はtransport MoonBit所有、未知terminal、duplicate JSON keys、UTF-8、byte/node/depth/ID lexeme、sync load待機、same-file reload、native numeric validation、close/quit、child/Worker/FD、load event reentry/deadline。取り込み担当は各comment→fix SHA→regression→新統合HEAD結果を対応づける。
3. 一例の [transport owner thread](https://github.com/f4ah6o/electron.mbt/pull/2#discussion_r4236387677) には対応報告があるが、[unknown terminal thread](https://github.com/f4ah6o/electron.mbt/pull/2#discussion_r4236387680) はthread内返信なし。いずれもこの棚卸しで再レビュー・resolveしていない。
4. PR:2で最後に取得した [GitHub review](https://github.com/f4ah6o/electron.mbt/pull/2#pullrequestreview-5482063690) の対象は `38bcf068...`。最新HEADの独立reviewはPR本文の報告であり、同SHAに対するGitHub review submissionの存在は確認できていない。
5. PR:3 / PR:8〜13は review submissions **0**、inline threads **0**。PR:8〜13のconversation commentsも0。独立review実施前を「指摘なし・承認済」としない。
6. PR:5はmerged後の [baseline P2 thread](https://github.com/f4ah6o/electron.mbt/pull/5#discussion_r4254073465) がunresolved/current。PR:8が後続修正候補。PR:6はinline4件resolvedでも [post-merge comment](https://github.com/f4ah6o/electron.mbt/pull/6#issuecomment-6136804622) に残存3件がある。top-level commentsも必ず読む。

## 問題

既存の main-local IPC と native host は独立に進んでいる。source の merge が通るだけでは、同じ Runtime が ID・lifecycle・codec・attestation を所有する保証にならない。さらに probe の自己申告と saved baseline の admission に既知の不足があり、ここを残したまま統合 CI の green を採用できない。

### 5. 優先する既存指摘と最小再現

| ID | 場所・原因 | 観測できた状態 | 対処・閉じる条件 |
| --- | --- | --- | --- |
| INT-P2-01 | PR:5 `scripts/differential.cjs` saved baselineのcompleted/pin/shape検証不足 | mainの指摘はopen。PR:8に修正実装とCIがあるが未merge | #8をレビューし、invalid baselineでcandidate未起動・exit1・report未作成を新mainで確認 |
| INT-P2-02 | `WKNativeProbe.m:566–567` DOM write/copyがOS-paste opt-in外 | main exact blobで無条件 `clipboard.writeText` / `execCommand('copy')` を静的確認。実macOS副作用再現は未実行 | DOM read/write/copyにも明示opt-in。既定実行でglobal clipboardを変更せず理由付きNOT_RUN |
| INT-P2-03 | `WKSyncBridgeProbe.m:71–76` と `macos-probe.cjs:125–149` が欠損observedを正常扱いできる | main exact blobのvalidatorへ7候補 `observed:{}` を渡すと `problems:[]`。拒否assertはFAIL | observed存在・型・期待値・coverage整合を直接検証。欠損/null/wrong typeをinvalidまたはinconclusiveへ |
| INT-P2-04 | `WKNativeProbe.m:82,613` nil→NSNull後にdictと仮定して添字アクセス | main exact blobに経路あり。native例外の実機再現は未実行 | NSDictionary型検査。nil/NSNull/string/late resultをstalled/PARTIALまたはinvalidとしてreport保存 |

1. INT-P2-02〜04の元根拠は [PR:6 post-merge review](https://github.com/f4ah6o/electron.mbt/pull/6#issuecomment-6136804622)。本書は修正済を主張しない。診断の正常な負の計測を捨てず、証拠欠損・自己矛盾を拒否する。
2. local確認環境はLinux / Node **v24.19.0**。`git hash-object` で validator / tests / NativeProbe / SyncBridgeProbe の4ファイルがAPIのGit blob SHAと一致した。
3. `node --test tests/macos-probe-validation.test.cjs` は **PASS / exit0**。実出力はfile-level 1 pass、fail0、skip0。試験登録数を推測して10件PASSとしない。
4. 追加のstdin `node` probeは、7候補の `attempted:true, executed:true, outcome:'as-expected', observed:{}` に対し拒否を要求して **FAIL / exit1**、実際の返却は `{problems:[],warnings:[]}`。既存greenと証拠検証の欠陥が両立する再現。
5. macOS/WebKit・MoonBit・Electronのlocal実行、clipboard副作用、NSNull例外の実機再現は **未実行**。§2のCI読取とは別の検証範囲。

## 目標

1. 全 PR の original HEAD/base と取り込み先 commit の対応を残し、0001 / PR #2 / PR #3 の未達受入を後続 owner へ漏れなく引き継ぐ。
2. INT-P2-01〜04 の原因別 regression を持ち、欠損 report が新規 verified に使われないようにする。
3. 同一 candidate SHA の core / facade / native / protocol / compiled artifact が組になる構成を作る。
4. renderer を接続する前に direct sender / document lifetime / typed codec の admission を確定し、reference-only と synthetic の証跡を native/app から分離する。

## 対象外

- 本 issue の着手時に既存 PR を無条件 merge、resolve、close すること。review と再現結果を先に揃える。
- QuickJS の再選定、strict contextBridge の互換認定、他 OS の GUI 実装、実アプリ・署名配布の全実装。
- 旧 0002 の片方を削除・上書きする採番整理、toolchain の無断 downgrade、CI skip の追加で green にする変更。
- main-local listener/invoke の成功だけで renderer の権限 I/O を有効化すること。

## 提案する方針

### 最初の bounded slice: INT-02 / EP-01

1. 現 main の `scripts/macos-probe.cjs::validateReport` と `tests/macos-probe-validation.test.cjs::baseSyncReport` を使い、下記の空 observed 反証を固定する。既存 positive fixture が空 object を含むため、テスト名を維持して中身だけ通す修正にしない。
2. producer の `WKSyncBridgeProbe.m::outcomeForCandidate` と `WKNativeProbe.m::phasePasteboard/outcomeForTrace` を照合する。欠損、実測した負の値、NOT_RUN、stalled を区別する詳細は 0015 が実装正本。
3. PR #8 の exact HEAD と新 main の saved-baseline 入口を比較し、取り込む commit と不要になった重複コードを review 用差分にする。新しい同等 validator を並行実装しない。
4. 最初の PR はこの evidence 修正と必要なテストに限定し、BrowserWindow / renderer bridge / QuickJS の機能追加は含めない。CI に与える変化は「無効報告の拒否」であり、strict gate の解除ではない。

| 既存 / 新規予定 | ファイル・責務 | 入出力と失敗時 |
| --- | --- | --- |
| 既存 | `scripts/macos-probe.cjs`、`platform/macos/WKSyncBridgeProbe.m`、`WKNativeProbe.m` | probe JSON → `{problems,warnings}`。missing semantic field は問題、理由付き未実行は coverage。native exception で成功 report を作らない |
| 既存 | `scripts/differential.cjs`、`core/differential.mbt`、`bridge/bridge.mbt` | baseline + unchanged fixture → scoped verdict。invalid baseline は candidate 起動前に exit 1、成功 comparison report を新規作成しない |
| 既存 | `tests/macos-probe-validation.test.cjs`、`tests/differential.test.cjs`、`core/differential_wbtest.mbt` | 真の観測を持つ positive と欠損/異常終了の negative を別 fixture にする |
| 新規予定 | `compatibility/integration-ledger.json` | document ID / PR / original SHA / candidate SHA / finding / test / evidence kind の対応。生成後は schema と重複 owner を検査 |

台帳生成器・ledger path は実装案であり、現 main の command ではない。初回の手書き mapping も同じ fields を満たせばよい。以後の累積統合は以下の順序に従う。

### 3. 各 PR の再利用範囲と保全する仕様

#### 3.1 merged 成果

| PR | main に入っている成果 | 統合時に保持する契約 |
| --- | --- | --- |
| PR:1 | MoonBit lifecycle / grants / request ledger、CJS loader、tiny-tree codec、private control probe、oracle基盤 | source/asset snapshot、型付き拒否、getter/toJSON/proxy 非実行、bounded allocation |
| PR:4 | compiled envelope dispatch、runtime-owned `electron` facade、toolchain checksum pin | 独立 userData、既存directoryのみsetPath、ready/quit引数、JSON leading whitespace |
| PR:5 | unchanged fixture differential、MoonBit比較、unexpected child failureの分類 | absent/null区別、同一fixture hash、異常終了時のreport拒否、synthetic output隔離 |
| PR:6 | sync-bridge/native acceptance probes、coverage・report validation | probe実行とnative acceptanceの分離、観測環境記録。§5の残存P2は別途修正 |
| PR:7 | MoonBit 0.1.20261012 / moonc v0.10.15+943464bfa pin | #2の古いv0.10.14 pinへ戻さない。更新後checksum/versionを再計測 |

PR:4 の [最終再レビュー](https://github.com/f4ah6o/electron.mbt/pull/4#pullrequestreview-5483733944) は4指摘への対応を `9216779` で確認している。最新 main への将来の統合でこれらが保持されたかは別途検証する。
独立 userData の既定値は `<appData>/electron.mbt/<name>`。同名 Electron アプリの `<appData>/<name>` を既定で再利用すると過去の P1 を再発させる。

#### 3.2 PR:2 — native host 系列の親

1. [元の native host issue](https://github.com/f4ah6o/electron.mbt/blob/bdc5886da0483da2b8dbecba21f95556b9263c6b/issues/open/0002-m1-native-host-contract.md)、[host設計](https://github.com/f4ah6o/electron.mbt/blob/bdc5886da0483da2b8dbecba21f95556b9263c6b/docs/0002-native-host.md)、[M0実現性記録](https://github.com/f4ah6o/electron.mbt/blob/bdc5886da0483da2b8dbecba21f95556b9263c6b/docs/0003-m0-contextbridge-feasibility.md) を既存正本として参照する。77 changed files / 137 commits の成果を空から書き直さない。
2. 再利用対象は actual AppKit/WKWebView、unchanged CJS main/dependency、BrowserWindow create/show/hide/close/destroy、native title/outer bounds/size/position、page URL/title、app ready/quit cancellation。
3. MoonBit が ID・document generation・protocol・pending/cancellation/terminal ledger を所有。control / navigation / event の独立 lane、enqueue 時からの deadline、Worker interrupt、FD/child rollback、host loss、close race を保持する。
4. 最新 navigation 修正は exact active `WKNavigation` + reserved generation を要求する。新 begin-load が古いcompletionを無効化してから stopLoading。retired finish/failure/provisional-failure の注入試験を残す。
5. 再利用後も未達は secure synchronous contextBridge、renderer sender/frame/document authority、cross-world proxy/revocation、完全なevent/window parity、third-party app differential、gpui integration、physical IME/AX/multidisplay、pack/sign/SBOM/measure、Windows/Linux。
6. overlapping application `loadFile` は明示unsupported。既存の制約を黙って解除しない。M0診断には page-forgeable sync reply / child誘導 / page initiator unauthenticated の負例があり、native main-frame情報だけで解消しない。
7. 小さな同一realm実装やprobeの成功を M0完了へ昇格させない。元issueの全未チェック受入項目は親0004または後続作業の明示的ownerへ対応づける。

#### 3.3 PR:3 — Node-less の設計決定と全受入を継承

1. [ADR-0001](https://github.com/f4ah6o/electron.mbt/blob/49ec04fac8f1db7212f98ade5a82128f1c4692e5/docs/adr/0001-nodeless-macos-runtime-decisions.md)、[targets台帳](https://github.com/f4ah6o/electron.mbt/blob/49ec04fac8f1db7212f98ade5a82128f1c4692e5/compatibility/nodeless-targets.json)、[Node-less roadmap](https://github.com/f4ah6o/electron.mbt/blob/49ec04fac8f1db7212f98ade5a82128f1c4692e5/issues/open/0002-node-less-electron-compatible-moonbit-roadmap.md)、[JS/TS実装issue](https://github.com/f4ah6o/electron.mbt/blob/49ec04fac8f1db7212f98ade5a82128f1c4692e5/issues/open/0003-nodeless-existing-js-ts-runtime.md) の4文書が既存設計。
2. QuickJS 2026-06-04 はPR上の選定済pin。vendor checksum、C ABI、license notices、FFI root/GC、exception、Promise jobs/timers、CJS identity/cache/cycle、native transportは実証待ち。選定の再開は具体的欠陥や検証結果を根拠に ADR 改訂として行う。
3. strict `electron-nodeless-v1` は初版 blocked / `compatible:false`、adapted は別 `electron-nodeless-adapted-v1`。page document-start の allowlisted Promise IPC + page内同期disposerに限定。任意preload closure互換を主張しない。adapted自体もnative security gate未通過。
4. 一次対象 Moji v1.0.5 @ `b7b1d585d61772a0f791f165c8d07a420443b65b` は表示・編集・open dialog・saveAs・reopen・quit。sync `webUtils.getPathForFile`、updater、export は初版除外。
5. 二次対象 jmd v0.2.3 @ `f875fc616feb89ea803a0fc140ec770a2ade041e` は CJS 入力と J1 受入。`jmd-file:` の privileged `bypassCSP` は安全設計が成立するまで unsupported。
6. A: unchanged CJS、B: upstream prepared JS、C: TS build-only を別入力モードにする。TS typecheckとemitを分離し、原本・lockfile/tool・生成JS/renderer・adapterのhashを記録。main ESM全面、任意npm/Node ABI、.node、ASAR無変更、JS→MoonBit一般変換は初期対象外。
7. N0依存inventory→N1a engine/FFI→N1b-adapted security→N2 Node-free native slice→N3 JS/TS facade→N4実アプリ/IME/AX→N5署名・clean machine・比較測定→N6他OS/更新継続を保全する。現Node版のPASSを工程完了の代用にしない。
8. JS/TS issueの J1/B1/T1/T2/E1/S-strict/S-adapted/S-negative/M1〜M3/N1/P1 の全受入IDを、新計画との対応表に残す。旧文書の既存除外は機能範囲として明示し、実用化の不都合な未達として削除しない。
9. 元0001/AGENTSのreal Node方針とNode-less profileの関係は、実装着手時に設計・実装ガイドを整合させる。文書追加だけで既存Node backendを置換・終了したとは扱わない。

#### 3.4 PR:8〜13 — 二系列にある増分を保持

| PR | 再利用する契約・設計 | 追加で必要な接続・制約 |
| --- | --- | --- |
| PR:8 | [baseline admission](https://github.com/f4ah6o/electron.mbt/blob/13087530502e3944b88fef8854c3123a3cdf90d8/docs/baseline-admission.md)：MoonBit validation、completed/pins/hash/shape、bounded input | PR:5後続。未mergeなのでmainのP2を閉じない |
| PR:9 | [main listeners](https://github.com/f4ah6o/electron.mbt/blob/b13f9f49ca35a58b30e6267b3b5de36755680f07/docs/ipc-main-listeners.md)：on/once/removal/order/identity、MoonBit-owned上限 | renderer deliveryは未実装。ipcMain.emit等のmain-local入口と特権受信を混ぜない |
| PR:10 | [handle lifetime](https://github.com/f4ah6o/electron.mbt/blob/8f006f94c9ce580f5705af60f3402f49779d85cc/docs/0004-contextbridge-handle-lifetime.md)、[JS registry](https://github.com/f4ah6o/electron.mbt/blob/8f006f94c9ce580f5705af60f3402f49779d85cc/docs/0005-contextbridge-js-registry.md)、[bootstrap](https://github.com/f4ah6o/electron.mbt/blob/8f006f94c9ce580f5705af60f3402f49779d85cc/docs/0006-contextbridge-native-bootstrap.md)、[CJS preload](https://github.com/f4ah6o/electron.mbt/blob/8f006f94c9ce580f5705af60f3402f49779d85cc/docs/0007-contextbridge-cjs-preload.md) | registryはhost-local。preloadのrequireはelectron含め全拒否、caught requireも失敗。同期cross-world proxyなし |
| PR:11 | [invoke kernel](https://github.com/f4ah6o/electron.mbt/blob/94736f0204fd19527f0c6041e1c2019e0f3b595d/docs/ipc-main-handlers.md)：handle/handleOnce/removeHandler、128 handlers、256 tickets、reply revocation | synthetic senderを実senderに差し替えるだけでは安全にならない。native authority経路が必要 |
| PR:12 | [undefined / late result](https://github.com/f4ah6o/electron.mbt/blob/95c9a3457de3f8b8641232e4ba1d29a273ba6fe0/docs/ipc-main-handlers.md)：invoke-json-undefined-v1、encoded-byte先行計数、reflection前後revalidate | full Structured Cloneではない。tiny-json-tree-v1とprofileを混ぜない |
| PR:13 | [native event](https://github.com/f4ah6o/electron.mbt/blob/9d73ebc6d6389f431f6664ae9f6acacf3fe30599/docs/0008-native-isolated-attestation-events.md)：one-shot / empty payload / generation / monotonic event ID | load ACKとrace可能。event単体はapp readiness・任意request authorizationではない |

PR:10 の最新設計は native bootstrap と application preload を別 WKContentWorld / handler / nonceに分ける。preloadがbootstrap handlerへアクセスできる古い構成へ戻さない。
PR:13 はこの最新版を取り込んでいる。bootstrap観測とpreload自己statusは信頼度が違う。preload自己申告の成功を悪意あるpreloadへの安全証明にしない。

### 6. 統合の作業順序・成果物・停止条件

#### 6.1 作業パッケージ

| ID / 順序 | 作業と担当役割 | 依存・成果物 | 次工程へ進む条件 |
| --- | --- | --- | --- |
| INT-01 | 台帳担当：snapshot更新、0002 alias、旧受入ID mapping | 0004・本書・PR:3原本。full SHA / URL / evidence kind付き対応表 | 0001 / #2 / #3の未達項目に漏れ・重複ownerがない |
| INT-02 | evidence担当：#8レビューと#6残存P2の独立修正 | #8を再実装せず採用候補として比較。INT-P2-01〜04の再現とpatch | negative report拒否、clipboard既定不変、例外時report保存を個別確認 |
| INT-03 | IPC担当：#8→#9→#11→#12を累積でレビュー | exact parent/child SHA、main-local listener/invoke contracts | 新main基点でMoonBit/Node正負・reference contract、stale/once/budgetを維持 |
| INT-04 | native担当：#2→#10→#13をmainへ統合する候補を作成 | INT-01/02、旧baseからの差分対応表。既存fixを含む履歴または明示commit mapping | actual macOS全lane・navigation・bootstrap/preload・one-shot・host lossがPASS |
| INT-05 | 統合担当：二系列のfacade/core/protocol/CIを接続 | INT-03/04。1 Runtime/session、versioned ABI、manifest profileを定義 | synthetic metadataなしの構成で起動契約と権限境界をレビュー可能 |
| INT-06 | IPC/security担当：native sender authority→renderer delivery | INT-05。profile別native観測・event・document ticketを相関。restricted-originalのload ACKとadaptedの早期ingressを0007/0009に従い区別 | 実renderer正例とiframe/DOM偽装/replay/reload/crash負例で無権限副作用なし |
| INT-07 | Node-less担当：#3に沿いQuickJS/native leafを実証 | 契約・fixture再利用、Node-API/Workerは実行backendから置換 | N1a / N1b-adapted成立、strictは独立blockedのまま |
| INT-08 | release担当：実アプリ・native受入・配布へ進む | 0004と0015の各出口、全旧受入ID mapping | CI・model review・実機・clean artifactそれぞれの証拠を満たす |

INT-03とINT-04のreview・移植準備、INT-07のpure engine feasibilityは独立に進められる。renderer privileged I/OはINT-06の成立前に有効化しない。
実装取り込みはまずreviewable candidateで行い、CIとレビューを満たした具体的な差分をmainへ反映する。今回の計画保存を既存実装PRのmerge実行に読み替えない。

#### 6.2 実際に交差するファイルと意味の衝突

PR changed-file集合から、native系列とIPC系列の交差は以下6ファイル。テキスト競合がなくてもAPI・所有権・event orderの不整合を調べる。

| ファイル | 保全・統合する意味 | 必須の再検証 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | #7 toolchain pin、main probe/differential、#2 native、#9/#11 kernel oracleの全gate | stepを落とさずbuild依存を整理。compiled-coreのsource SHAとartifact provenanceを照合 |
| `bridge/bridge.mbt` | #4 envelope全core dispatchと#9 listener exports | ABI export欠損・unknown op・leading whitespace・raw bounds、同一Runtimeへの接続 |
| `bridge/moon.pkg` | #8 baseline / #10 context / #11 handlerのcompile対象と公開面 | JS/nativeで各境界を実compile。旧core artifactを新adapterへ流用しない |
| `core/runtime.mbt` | native lifecycle + listener/invoke/context registry所有・revoke順序 | runtime stop/navigation/destroy/host lossで全pending/handleを失効、重複terminalなし |
| `compatibility/manifest.json` | A〜J / M0 gates、#7 pins、main-local/undefined profile、証拠参照 | newest file全採用で他系列のgate/unsupportedを消さず、evidenceごとSHA一致 |
| `scripts/oracle.cjs` | #8 admissionと#2拡充済同期/throw/Promise/callback/freeze実測 | 同一fixture、completion/versions/hash/型、unknown failure、one markerのみ受理 |

1. 別pathの `bridges/node/runtime-facade.cjs`（#2）と `electron-facade.cjs`（main/#9）にも意味の衝突がある。app lifecycle/userData/BrowserWindow/IPCを2つの状態機械として並存させず、backend差だけをleafへ分ける。
2. native transportのwire version、event-only operation、CJS bridge exports、compiled artifactを一組で更新する。旧peerに新eventを黙って無視させず、version/profile mismatchを型付きで拒否する。
3. #10/#13のpage/bootstrap/preload3realm、2handler/nonceの分離をfixtureで直接assert。generic message relayや共有DOMを権限I/Oのtrusted入口にしない。
4. #9〜12のtiny-tree/invoke-undefinedはJSONプロファイル。同期contextBridgeのfrozen copy、関数/Promise/error/callback proxyが使えるというmanifestに書き換えない。
5. #4修正済userData/setPath/event引数、#5のfailure分類、#6実native受入の未実行項目を失わない。差分適用後は「ファイル競合なし」で終了しない。

## 受け入れ条件

下記は candidate の確認項目であり、この polish でチェック済みにしない。G-01〜G-10 の ID と従来の §7 アンカーは保持する。

### 7. 統合 gate と Given / When / Then

- [ ] **G-01 / source:** Given 二系列のexact HEAD、When merge/rebase/cherry-pick候補を作る、Then base/head/tree/取り込みcommit対応表と差分が再現できる。必要な履歴をforce-pushで消さない。
- [ ] **G-02 / scope:** Given 0001・旧0002二件・0003、When新台帳を生成する、Then全未達受入IDが後続owner・test・statusへ対応し、未実装を削除・completedにしない。
- [ ] **G-03 / baseline:** Given aborted/wrong-pin/wrong-hash/null/missing observation、When referenceを読み込む、Then candidate起動前に拒否し新規compatible/report成功を出さない。valid negative計測は保持する。
- [ ] **G-04 / protocol:** Given unknown/duplicate/out-of-range/fractional-lexeme/invalid UTF-8/duplicate-key frame、When nativeへ送る、Then 副作用前に拒否し正規pendingを消費しない。1 MiB・depth64・node100000等のprofile別宣言上限を統合先で再照合する。
- [ ] **G-05 / lifecycle:** Given slow load/close/quit/reload/host loss、When terminalやretired WKNavigation callbackが遅着する、Then exact session/window/generation/requestだけが完了し、event loop停止・orphan FD/child・架空closedが発生しない。
- [ ] **G-06 / attestation:** Given restricted-originalのbootstrap/preload分離とnative load、When event→ACK / ACK→event / duplicate / missing / failed preloadを試す、Then 両native観測とcurrent documentの相関前にcapabilityを発行しない。元preload未実行のadaptedは0007/0009の別installation/early-ingress gateを使い、このattestationを偽って生成しない。
- [ ] **G-07 / IPC:** Given 実rendererと悪意あるiframe/DOM message、When invoke/on経路を通す、Then 実native authorityだけで許可・拒否される。synthetic `mainFrame:true` を本番入力にしない。
- [ ] **G-08 / once and result:** Given denied/oversize/capacity-exceeded/never-settling invocation、When once登録とrevokeが競合する、Then onceを不正消費せず、late result getter/serialization前にticketを再検証しtyped cancellationを保持。
- [ ] **G-09 / regressions:** Given 旧main/#2のfix一覧、When 新facade/coreを実行する、Then userData分離、setPath拒否、ready/quit引数、bounds、reentry、queue deadlineを維持。修正とテストのSHAを対応づける。
- [ ] **G-10 / claims:** Given 各platformの結果、When manifestを更新する、Then reference-only/synthetic/diagnostic/native/real-app/packagingを別証拠として表示。SKIP/NOT_RUN/PARTIAL/blockedをPASSに変換しない。

## テスト計画

### 初回に使う既存 command

repository root で実行する。probe validator のみの修正では最初の command と下記 stdin 反証で原因を確認し、native producer / core の変更を含めた時点で該当 lane を増やす。

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

この反証は `problems.length > 0` を期待する。元 main では FAIL / exit 1 が欠陥の再現、修正後は PASS / exit 0 となることを要求する。2026-10-17 の polish では既存 test を再実行し file-level PASS 1 / FAIL 0 を確認した。反証の既存 FAIL 記録は §5 の実施結果であり、native 実行結果ではない。

```sh
moon check --target js
moon test --target js
moon test --target native
npm run build
node --test tests/differential.test.cjs tests/manifest.test.cjs
```

上の追加 lane は実装候補に対する将来の実行計画で、今回未実行。`dist/core.cjs` が必要な Node テストは build 後に行う。macOS producer の変更後は disposable な macOS GUI 環境で `node scripts/macos-probe.cjs --build-only`、次に opt-out / opt-in の実実行を分ける。R02 の修正前に個人 clipboard で probe を再現しない。

### 8. レビュー・検証・失敗時の扱い

1. 統合候補HEADで `moon check --target js`、`moon test --target js`、`moon test --target native`、`npm run build`、`npm test` を実行する。各laneのnative acceptanceコマンドは既存CIを保全し、[0015](0015-oracle-ci-and-evidence.md) のevidence schemaで記録する。新候補に対するこれらのテストは**未実行**。
2. independent reviewはexact candidate HEADを指定し、状態所有、false PASS、realm/frame/document、sync semantics、byte/queue budgets、userData・file grants、toolchain provenanceを対象にする。過去レビューを新HEAD承認へ転記しない。
3. CIが失敗したら、場所・実際のエラー・確認できた原因・修正案を記録する。環境差で試験不能なら対象をNOT_RUNとして残し、root causeを推測で断定しない。running jobはcompleted/failed等になるまで実状態を追跡する。
4. 旧PRの指摘をresolveする条件は、finding→fix→negative regression→新HEADの実行結果が揃うこと。GitHub操作は実際の統合作業で行い、本計画では元threadを変更していない。
5. 相互依存の不具合はleafの小修正へ切り出す。統合失敗でmainを巻き戻したり未コミットをdiscardせず、候補を修正または差分を分割する。事後にgateを緩めてgreenにしない。
6. 本issue完了は全計画の実用化完了ではない。INT-01〜06の統合候補・未達対応表・レビュー・証拠が揃い、後続Node-less/実アプリ/配布工程へ同じ契約を渡せたときに判断する。製品の出口は0004を参照する。

## リスク

| Risk | 検出・抑止 | 担当と停止範囲 |
| --- | --- | --- |
| 元 PR の修正や未達 gate が統合で消える | 全 SHA と finding→fix→test の対応、6 交差 file と別名 facade の意味比較 | Integration owner。該当 stack の取り込みを停止し差分を修正 |
| 古い CI / synthetic sender で権限経路を認定 | evidence の head/profile/driver scope を検査 | Evidence / Security owner。新規 gate 昇格を停止 |
| malformed report の修正で有効な負の観測まで捨てる | expected-rejection / NOT_RUN / invalid-evidence を別 fixture にする | Evidence owner。reader/schema のみ再検討し、元 raw report は保持 |
| native / IPC の二重 Runtime と terminal | shared owner、late callback / close / revoke / queue 回帰 | Core / Native owner。renderer 接続前に解消 |

詳細な継続保守の trigger・再開条件は [0021](0021-decisions-risks-and-maintenance.md) の R01〜R11 と併用する。

## 変更履歴

- 2026-10-17: 既存 PR 1〜13、CI/review snapshot、INT / G 受入、旧 0002 alias を作成。
- 2026-10-17 polish: 必須メタデータと 11 セクションへ再構成。全 SHA/CI 件数・残存レビュー・最小再現を保持し、最初の変更単位、既存/新規 path、入出力・拒否、限定 command と readiness を追加。元の番号付き見出しは文字列を変えず下位階層へ移動。

## 注記

**準備状態:** INT-01/02 の棚卸し更新・欠陥再現・修正候補作成、INT-03/04 の独立 review は着手可能。開始を妨げる追加の製品判断は本 issue 内にない。native/renderer の統合完了は §6/§7 の前提と実機証跡で判定する。実装が未完了という理由だけで着手不可とはしない。

`Status: open` と `issues/open` は既存運用・ユーザー指定の保存先・AGENTS の runtime 受入まで open を維持する指示に合わせる。文書品質と runtime readiness は別欄で管理し、この polish では move/transition を行わない。Branch は実装候補の提案名で、作成済みを意味しない。

固定 source・PR・review・run URL は本文にすべて残した。現在の主担当は 0015 と同じ欠陥を二重実装せず、0005 が取り込みと scope 台帳、0015 が evidence 契約・validator の実装を所有する。
