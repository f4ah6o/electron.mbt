# 0009: Native host・window lifecycle・停止性の実装設計

Status: open
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: feat/issue-0009-native-lifecycle

## 概要

**性質:** 既存native hostの統合と、製品lifecycle/停止性の実装親Issue。**利用者への影響:** windowの表示・閉じる取消・保存中終了・異常終了を、実OSの状態と一致する戻り値/event/診断として扱う。

| 項目 | 内容 |
| --- | --- |
| 優先度 | P0 |
| 既存作業 | PR #2、#10、#13。実験hostを再実装しない |
| 依存 | [0005 統合](0005-existing-work-and-integration.md)、[0006 architecture](0006-runtime-architecture-and-profiles.md) |
| 関連 | [0007 bridge](0007-context-bridge-feasibility-and-security.md)、[0011 load/storage](0011-app-loading-origin-and-storage.md)、[0019 native操作](0019-native-interaction-and-accessibility.md) |

最初は[0020のEP-03](0020-implementation-work-packages.md)としてPR #2を最新mainへ統合する。新engineへの切替と全window APIを同じPRで行わない。

## 背景

### 1. 現状と残る差分

mainには独立probeがあり、PR #2には実AppKit/WKWebView host、Node-API private channel、compiled MoonBit session、実window作成/可視性/geometry/read/load/close/quitがある。通常run/packは依然として閉じている。PR #10/#13はこの系統にisolated bootstrap/preloadとone-shot attestationを追加する。Node-lessのnative supervisorとQuickJS runnerはまだ存在しない。

引き継ぐものはprotocol、相関検証、native ACK、close cancellation、navigation identity、故障fixture。新しく必要なのはnative coreの正本化、Main engine非依存transport、実ユーザー操作、load/paint/readyの区別、DOM終了契約、product teardownとdistribution可能なpublic API境界である。

現行mainの [core](../../core/runtime.mbt) / [core tests](../../core/runtime_wbtest.mbt) ではready、close/quit取消、navigate、request終端を確認できる。[Node transport tests](../../tests/transport.test.cjs)はtimeout後channel失効、crash/truncated/oversized/invalid UTF-8を検証する。[WKWorldProbe](../../platform/macos/WKWorldProbe.m)は独立したfeasibility probeであり、製品window lifecycleではない。これらのfileとPR #2系の成果を区別して統合する。

## 問題

OS windowの作成/表示/paint、WebView load、documentの特権admissionは同じ完了ではない。cancelable closeをnative破棄後に通知すると、利用者が取消してもwindow/dataを保持できない。

Main同期getterとUI callbackが互いの完了を待つ設計、旧navigation/late callbackの再利用、FD番号の早期再利用は停止性とauthorityを破る。既存probeや純粋state machineだけでは、実native eventと資源回収の結果を証明できない。

## 目標

- W1〜W5の必要subsetを順序付きで追加し、同期戻り値・取消・OS実状態を同じtraceで確認する。
- Session/Window/Document/Load/Closeのstateとownerを分け、current generationだけを有効にする。
- host/Main/WebContentの故障とshutdownをboundedに終端化し、未確定のfile副作用をunknownとして報告する。
- PR #2の実験系とNode-less製品構成を別evidenceで受入し、productionにtest-only private selectorを含めない。

## 対象外

このIssueだけでのstrict contextBridge完成、任意BrowserWindow option、全OS対応、OS共有processの強制終了は含めない。Mojiの実data保存policyは0011、実機入力/AXは0019、配布は0016と接続して受入する。Windows/Linux hostと汎用gpui WebView attachは別scopeとする。

## 提案する方針

### 2. スレッドとnative objectの所有権

1. `NSApplication`、NSWindow、WKWebView、WKWebsiteDataStore、delegateはUI threadで生成・参照・破棄する。
2. I/O readerはframeを上限内に受信し、型付き要求をcoreへ渡す。UI操作はdispatchして結果を非同期に回収する。
3. Mainの同期APIはMain runnerだけを待たせる。UI threadは返答を得るためMain callbackの完了を同時に待たない。
4. native adapterに残すgeneration/tokenはcore発行値の照合用であり、adapter独自のgrant発行を許さない。
5. UI object破棄後のcallbackはowner tokenの失効確認を先に行い、disposed objectをdereferenceしない。

### 3. 状態と遷移

#### 3.1 Session

| state | 入力 | 次状態 / effect |
| --- | --- | --- |
| Created | child spawn成功 | Handshaking。継承FDとpidを台帳へ |
| Handshaking | version/profile一致・UI準備完了・CJS同期entry評価のlistener登録checkpoint | Ready。将来ESMの全Promise settlementは要求しない |
| Handshaking | timeout/EOF/version不一致 | Failed。部分生成分を逆順に解放 |
| Ready | graceful quit | Draining。新規要求の可否をoperation別制限 |
| Ready/Draining | protocol破損・host/runner loss | Failed。一度だけ全pending失効 |
| Draining | before-quit/will-quit/window close取消 | Ready。未確定のcloseだけ取消し、既に閉じたwindowを捏造して復元しない |
| Draining | 子終了・native解放完了 | Closed |
| Failed | owned resource回収完了 | Closed。旧session再利用禁止 |

session失敗時に正常な `quit` / `closed` eventを捏造しない。native子異常終了とユーザーcloseを別terminal reasonにする。

#### 3.2 Window / document

| object | 正常系 | 取消・異常系 |
| --- | --- | --- |
| Window | Creating → Live → Closing → Destroyed | create失敗で破棄、close取消でLive復帰 |
| Document load | Reserved → Loading → LoadComplete | failed/redirect/navigation/crashで失敗・失効 |
| Document authority | Unproven → profile別proof充足 → DocumentIngressReady | 別generation/失敗/破棄でRevoked |
| Load request | Queued → Dispatched → NativePending → Terminal | deadline/別load/host lossでcancel/error |
| Close request | Requested → MainDecision → DOMDecision → NativeClose → Closed | Main/DOM取消でcancel token ACK |

loadとbootstrap/installationは観測順が前後するため独立flagと同じgenerationを使う。restricted-originalの既存経路は成功load ACKとPR #13のisolated bootstrap/preload proofを合流させる。adaptedは元preloadを実行しないため、別のadapter-install observationを要求する。共通の一直線event順序や、全profileに同じattestationを仮定しない。

#### 3.3 PR #13 attestationとloadのrace

1. `isolated-preload-attested`はnative event lane、load ACKは別laneから届く。
2. 先にattestationが来てもauthorityを付与せず、pending observationとして保存する。
3. load成功後に同一window/generationの `get-bootstrap-status` を照合する。
4. load failure、redirect、preload unsupported/caught unsupported、reload、session lossで両flagを破棄する。
5. 重複attestation、遅れた旧generation、別window eventはrejectし、現在のreadyを変えない。

attestationは隔離preloadの観測であり、任意のpage-originated呼出しを認証するものではない。

#### 3.4 Adaptedの早期ingressとload完了

1. nativeがnavigation前に固定topic routeを準備し、document-start adapterを設置する。独立bootstrap、adapter-install observation、actual native document/world/frame、current generation、schema/policyを同時に照合する。
2. この条件が揃った `DocumentIngressReady` からRPCをadmitする。`loadFile`のfull ACK / `didFinishNavigation` は別の `LoadComplete` であり、初回RPCの返答を待つpageとの循環を作る必須条件にしない。
3. load完了前のnative document識別が公開APIで成立することは未証明。0007の実機negativeが通るまで早期grantを有効化しない。pageが自己申告したadapter-readyをnative proofにしない。
4. Mojiのfirst callはadmission前にbounded queueへ置き、ready deadline、reload、失敗で一度だけrejectする。late readyで旧queueを再生しない。
5. 後のload failureは新しいadmissionと旧replyを止める。既にacceptedなMain handler/file side effectは自動rollbackではなく0011のcommit-point結果として扱う。
6. first module awaitの実orderingと、初回RPCまでload-blocking resourceを保留する循環fixtureを分けて試験する。top-level await単体が必ずloadを止めるとは断定しない。

### 4. Electron window surfaceの実装順

| group | API / event | 新しい実装・検証 |
| --- | --- | --- |
| W1 | constructor、show/hide/isVisible、title、bounds | PR #2を統合しactual native ACKを維持 |
| W2 | loadFile、did-finish-load、did-fail-load、getURL/getTitle | cancelled navigation、retry、title更新の別観測 |
| W3 | close/destroy、before-quit/will-quit/quit | reentrant callbacks、throw、複数window、DOM beforeunload |
| W4 | focus/blur、move/resize、maximize/minimize、ready-to-show | real native notificationsとElectron部分順序 |
| W5 | activate、open-file、single-instance、window restoration | Mojiの起動時/再起動時利用を優先 |

AppKit外枠とcontent size、primary-screen top-leftとbottom-leftを区別する。`setSize`等は既存actual geometry取得契約を利用し、JS側のread-modify-write cacheを増やさない。複数display、負座標、DPI移動、OS clamp後の値は実測する。

### 5. load完了・表示・入力可能を分ける

Electronの `ready-to-show` は描画に関するeventであり `did-finish-load` と同じではない。WKWebViewの `didFinishNavigation` をそのままready-to-showへ別名変換しない。

1. 公開WebKit APIで対応する描画観測を定義し、同一fixtureのイベント順を比較する。
2. 第一page script、DOM ready、load、first visible frame、first input ACKのtimestampを別々に記録する。
3. strict parityが実証できなければ、そのeventはunsupportedまたはpartialのままにする。
4. adapted appがこのeventを必要とする場合、adapter変更を明示し、そのアプリ操作が初期空白/flashなく完了することを別に評価する。

### 6. close / beforeunload / quit

Mainの `close` callbackは同期の取消点である。native closeボタンからの要求をevent tokenで保留し、Main判定を受けてnative ACKへ進める。callbackのthrowやnested close/quitで同じwindowを二重破棄しない。

DOM `beforeunload` はElectron固有の取消条件を含む。通常ブラウザと同一と仮定せず、return value、`event.returnValue`、listener形式、reload、quit、destroyそれぞれをoracleで固定する。任意DOM内のデータ保存をhostが保証したことにはしない。

| What | 合格条件 |
| --- | --- |
| closeを取消して次のcloseを受ける | 古いcancel tokenが新要求を取消さない |
| 2windowの2番目がquitを取消す | appはReadyへ戻り、残存window状態とgrantsが整合 |
| close中のMain exception | native windowと台帳の実状態を保持、失敗が見える |
| save Promise保留中のquit | accepted保存と未完了保存を区別し、勝手に再実行しない |
| destroy | cancelable closeと異なる対象Electron契約を実装 |
| host loss中のbefore-quit | 正常quit成功を報告しない |

### 7. 停止・crash・資源回収

所有資源は `{ownerSession, ownerWindow?, generation?, kind, acquired, released, terminalReason}` の台帳へ記録する。FD、pipe、thread、process、JS root、timer、native delegate、dialog、data store、pending replyを含む。

1. graceful停止で新規admissionを止め、pendingを理由付き終端化する。
2. reply laneを閉じる前に待機threadをshutdownで起こし、join後にFDをcloseする。FD番号の再利用raceを防ぐ。
3. renderer/WebContent crashはそのdocumentを失効させる。独立window/hostを生存させられるかは実host試験で判定する。
4. Main無限loop/異常終了、host異常終了、transport EOF、partial spawn失敗を別々に注入する。
5. supervisorが管理する子にはgraceful→期限付きterminate→killを使い、同名process全体をkillしない。
6. WebKit共有processを名前だけで終了させない。公開APIで観測できない帰属はunknownとして記録し、全process回収PASSとしない。
7. app保存や外部操作が実行された後の通信断は `outcome-unknown` と内部診断し、non-idempotent操作を再送しない。

PR #2のprivate WebKit selectorを使うkill試験はcompile-time test buildのみを維持する。production binaryのsymbol/string/import監査でtest-only経路の混入を拒否する。このprobe成功だけでOS SIGKILL、GPU process回収、自然crash耐性を完了にしない。

### 8. 分割PRと検証

1. PR #2を現在mainと再統合し、constructor/geometry/close/故障fixtureを保つ。
2. generation/attestation readiness joinを追加し、PR #13のnative eventを安全に消費する。
3. native supervisorとQuickJS runnerを最小window fixtureへ接続する。
4. lifecycle/event mappingとDOM closeの差を一つずつ実装し、oracle結果を更新する。
5. real input、複数window、process故障を製品構成で実行する。

検証targetは `host-protocol`、native lifecycle、actual WKWebView、Node-backed regression、QuickJS-native integration、process faultとする。新規command名は実装PRが定義する。本書だけで未存在commandを実行可能としない。

#### 変更対象と最初の限定PR

| 既存 / 予定 | 対象 | 最初の扱い |
| --- | --- | --- |
| main既存 | `core/runtime.mbt`、`core/runtime_wbtest.mbt`、`bridge/`、`tests/transport.test.cjs` | state/取消/上限/typed failureを回帰で保全 |
| PR #2由来 | `platform/macos/` native host、`transport/`、host protocol/fault fixture | exact PR HEADから取り込み、#4のdata/ready/quit/JSONと#7のpinを保持 |
| PR #10/#13由来 | isolated bootstrap、preload status、one-shot attestation | EP-04で別統合。early adapted proofを実装済みとしない |
| 新規予定 | `host/` native supervisor、`bridges/embedded-js/` runner接続 | EP-10以後。旧Node topologyを同時に反転させない |

最初のPRはmainとの競合解消・constructor/geometry/closeの既存trace・故障回帰に限定する。outdated reviewも0005の残論点から確認し、旧HEAD CI successを新統合SHAへ流用しない。次にattestation相関、native supervisor、W3/W4を別PRへ進める。

## 受け入れ条件

### 9. 完了条件

1. 指定profileのwindow/app subsetが実native入力とoracle比較を通る。
2. 正常終了/取消/故障の全pathでowned resourceが回収され、未観測のOS共有processは明示される。
3. Node-less profileでNode process、Node-API addon、Node launcherへ依存しない。
4. core/native境界とpublic APIのみのproduction buildが独立レビュー済み。
5. strict bridgeや他OSが未完でも、その未完状態を保持したscopeで記録する。

- [ ] Given exact PR #2と最新main, when 最初の統合を行う, then native ACK/geometry/close cancellationと既存data/JSON/pinの回帰が同SHAで通り、保留reviewの扱いが記録される。
- [ ] Given event/ACKの到着順が逆転または旧generationである, when readinessを判定する, then current profileの必要observationsだけが一度成立し、stale eventは再活性化しない。
- [ ] Given Mojiのshow:falseと初回RPC, when load/ingress/paintを観測する, then 初回callは有限queueで扱われ、full loadとの循環待ちや架空ready-to-showがない。
- [ ] Given dirty window / pending save, when close・quit・取消・host lossを起こす, then windowの生存と実file結果が一致し、同じ保存や終了を自動再実行しない。

## テスト計画

| 確認 | 現存entry / 後続fixture | 前提と結果の範囲 |
| --- | --- | --- |
| core取消・世代・queue | `moon test --target js`、`moon test --target native` | pure contract。native OS操作とは別 |
| Node-backed同期境界 | `npm run build` 後 `node --test tests/transport.test.cjs tests/core-integration.test.cjs tests/facade.test.cjs` | 既存Node-APIの回帰。QuickJS結果へ転用しない |
| 現行WebKit probe | EP-01のclipboard opt-in修正前はmacOSで `node scripts/macos-probe.cjs --build-only`。修正後に0015のdisposable環境でopt-out / opt-inを分けて `npm run probe:macos` | Xcode/WindowServerとREADMEのpinが必要。build-onlyは実行証拠ではなく、実probeもproduct host完成の証拠ではない |
| PR #2統合 | exact branchのhost-protocol/native/fault entryを取り込んだPRで実行 | 現mainに未存在のentry名を捏造しない。取得したcommandと新SHAを保存 |
| 新product | ACK/event逆順、early call、nested close/getter、partial spawn、SIGKILL/EOF | public APIのみのactual hostで実行。現時点NOT_RUN |
| Moji/操作 | 0014 M1〜M3・0019 G cases | 実IME/保存bytes/exit ledgerを同candidateへ紐付ける |

現時点の整備ではnative host/GUI/faultを実行していない。関数表やpendingが0という観測と、OS object/processが回収済みという観測は分離する。

## リスク

| リスク | 対応・review条件 |
| --- | --- |
| close取消後にgrants/windowを戻せない | native破棄前にdecisionを保持し、既に閉じた別windowを捏造して復元しない |
| UIとMainの相互待ち | SYNC-01相当のcallback内getter/quit再入を実fixtureで確認 |
| late callbackが新object/FDを参照する | generation/token失効、thread join後close、重複ACK拒否 |
| test-only kill hookが製品へ混入 | compile-time分離とbinary symbol/string/import audit |
| 保存済みだがreply喪失 | commit record/readbackでcommitted/unknownを区別し、非冪等操作を再送しない |

## 未解決の質問

| 判断が必要な点 | 判断owner / 必要な証拠 | 再開条件・依存scope |
| --- | --- | --- |
| adapted early document identityを公開APIで取得できるか | WebView/security担当。0007のnative proofとiframe/旧epoch/偽ready負例 | PASSしたvariantのみ3.4を有効化。PR #2統合、W1、supervisor fixtureは先行可 |
| ready-to-showとDOM beforeunloadの必要契約をどこまで再現できるか | native/Electron oracle担当＋app owner。固定Electron trace、public WebKit観測、Moji show:false/dirty-close試験 | parity成立なら該当surfaceを追加。不成立なら明示adaptationと影響をADR化するまでW4/Moji該当操作は未受入 |
| crash後の独立window/共有WebKit processの帰属をどこまで観測できるか | native/resource担当。actual process/owner ledger、自然crashまたはpublic制御下fault | 観測可能範囲をsupported matrixへ固定。unknownを残す間は全process回収を主張しない |

## 変更履歴

- 2026-10-17: native owner、state、profile別ingress/load、W1〜W5、close/quit、fault/cleanupの設計を追加。
- 2026-10-17: `polish-issue`で現行core/Node transport/probeとPR由来hostを照合。EP-03の限定統合、変更path、具体的な受入/command、未決事項のownerと再開条件を追加。state契約・W番号・出典・旧節anchorを保持して再構成。既存runtime/PR状態は変更していない。

## 注記

- **状態・配置:** 整備前後とも `Status: open`、`issues/open` を維持する。現repositoryにはこの状態ディレクトリがあり、今回の指定先でもある。`polished` / 保留用ディレクトリを新設せず、本文の準備状態とruntimeのverifiedを別に記録する。
- **準備状態:** PR #2の最新base統合・既存state/transport回帰とW1/native supervisor fixtureは着手可能。early ingress、paint/beforeunload parity、shared-process帰属の追加能力は上記の観測待ち。
- **再開・復帰先:** 未解決事項は「未解決の質問」の証拠・担当roleで判断し、解決後も既存 `issues/open` の同pathへ記録する。将来repositoryの状態遷移を採用する場合は、その規約を確認してから遷移する。
- **ブランチ:** `Branch` の `feat/issue-0009-native-lifecycle` は実装時の提案名であり、この整備で作成したbranchではない。既存PRの履歴を消さず、小さい統合PRへ分ける。
- **確認基点:** 本整備のmainは `8177cf051976b8d7b9eca25ae7ad8820bb04a719`。初回設計の `30c6fc97186e7ecfc8397c799525f00c8e4f0f65` と各PR/appの固定SHAは履歴根拠として保持する。mainへのPR統合・runtime実装・native E2E完了を意味しない。
- **検証の範囲:** 2026-10-17のpolishはIssueと関連source/testの読取・文書整合を対象とする。下記のruntime/GUI/配布試験は、この本文更新では実行していない。実行する際はcommand、対象SHA、環境とPASS / FAIL / NOT_RUNを別記録にする。

### 10. 出典

1. [PR #2 native host](https://github.com/f4ah6o/electron.mbt/pull/2)、[PR #10](https://github.com/f4ah6o/electron.mbt/pull/10)、[PR #13](https://github.com/f4ah6o/electron.mbt/pull/13)。確認HEADは0005参照。
2. [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) — close/beforeunload、ready-to-show、geometry。適合実行はElectron 44.7.0に固定。
3. [現行core](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/core/runtime.mbt)
