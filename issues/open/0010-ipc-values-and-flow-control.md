# 0010: IPC ingress・値転送・backpressureの実装設計

Status: open
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: feat/native-ipc-admission-contract

## 概要

main-local IPC kernel を、認可された実 renderer の operation へ接続する実装 issue。P0。利用者への影響は settings/保存などの Promise 結果、イベントの順序、reload 後の旧操作拒否、過大入力時の明示失敗である。

**最初の着手単位は main kernel の統合回帰と、handler を呼ばない拒否専用 admission contract。** native sender の成立調査と並行して実装できる。実 renderer から Main を呼ぶ positive 経路は、0007/0011 の native document proof を依存 gate とする。

| 項目 | 内容 |
| --- | --- |
| 優先度 | P0 |
| 既存作業 | PR #9 listener、#11 invoke、#12 undefined codec、#13 native attestation |
| 依存 | [0006 architecture](0006-runtime-architecture-and-profiles.md)、[0007 bridge](0007-context-bridge-feasibility-and-security.md)、[0009 host](0009-native-host-lifecycle-and-processes.md) |
| 検証 | [0015 evidence/CI](0015-oracle-ci-and-evidence.md) |

## 背景

### 1. 現在できる部分と新規実装

PR #9はmain-local EventEmitter subset、#11/#12はtrusted synthetic host metadataから呼ぶinvoke kernelを実装する。PR #13はisolated preload成功のnative eventであり、renderer requestのingressではない。したがって既存kernelのequivalentを、実 `ipcRenderer`、native sender認証、実アプリ互換の証拠にしない。

本issueは既存kernelを再利用し、実documentから許可operationをMainへ配送し、値/例外/取消/順序を正しく返す経路を作る。strictとadaptedで公開面は別にする。listenerを登録しただけでrendererへchannel権限を発行しない。

[現在の core](https://github.com/f4ah6o/electron.mbt/blob/8177cf051976b8d7b9eca25ae7ad8820bb04a719/core/runtime.mbt) と [codec](https://github.com/f4ah6o/electron.mbt/blob/8177cf051976b8d7b9eca25ae7ad8820bb04a719/bridges/node/clone.cjs) を読み直した。現 main の facade は ipcMain/ipcRenderer を unsupported とするため、上記 PR の kernel の到達点と main 実装を分ける。

## 問題

既存の synthetic sender metadata を body 由来の object に置き換えるだけでは、発信 document を認証できない。listener の存在も renderer の操作権限ではない。先に handler/handleOnce を消費すると拒否した入力が副作用や登録消失を起こす。

`tiny-json-tree-v1` と Electron IPC/contextBridge の値領域は異なる。codec の範囲、queue の所有者、copy/settlement 時点を固定しないと、undefined の消失、例外検査中の再入、late reply の誤配送が発生する。

## 目標

認可前の request は handler invocation count 0・ticket 消費 0 で拒否する。認可済み request は snapshot した引数で一度だけ handler を呼び、生きている元 document の route に一度だけ終端を返す。全 pending/roots/bytes を有限にし、暗黙 retry や silent conversion を加えない。

## 対象外

`ipcRenderer.sendSync`、全 Structured Clone、transferable/shared memory、任意 channel の page 公開、frame 対応を main frame へ偽装する互換、strict contextBridge の解決を含まない。Main app principal が既に受理した処理の副作用取消も提供しない。

## 提案する方針

### 最初の bounded slice と変更箇所

1. PR #9→#11→#12 の exact HEAD と変更履歴を保持して統合する。現在 main の `core/runtime.mbt / core/validation.mbt`、`bridges/node/clone.cjs`、`tests/core-integration.test.cjs / clone.test.cjs / facade.test.cjs` を回帰の入口にする。PR の callable handler/undefined 実装を新実装として複製しない。
2. MoonBit に内部 `SenderContext / AdmissionResult` を追加する案とする。入力は native observation、profile/operation ID、bounded encoded payload。出力は `Denied(reason)` または `Accepted(ticket, capturedHandlerId, returnRoute)`。MoonBit は handler の ID/所有権を保持し、実 closure は Main realm が所有する。公開 facade に native identity constructor を出さない。
3. 第 1 PR では missing/foreign/stale identity、unknown operation、capacity overflow を常に拒否する。native callback を受ける leaf は `platform/macos/`、policy/ticket は `core/`、private frame codec は `transport/` の既存 PR と統合する追加先である。
4. Positive admission は EP-14 の完了対象で、EP-15 の source/origin/native document identity が必要。B1 sender/relay ADR は EP-06 の必須共有作業として確定し、strict B5 の成功を待つ依存にはしない。

### 互換性・移行

`tiny-json-tree-v1` を黙って新 codec へ変更せず、PR #12 の `invoke-json-undefined-v1` を version negotiation で選ぶ。unknown version は拒否する。main-local trusted values と native-ingress evidence は別 scope。Main の fs/service 呼出しへ global currentSender を後付けせず、document grant は renderer admission、Main app principal は受理後の処理に適用する。

現 core の既定は payload 1,048,576 bytes、pending と未配送取消の合計 256、queue 4,194,304 bytes、channel 128 code units、grants/document 128。codec は depth 64 / nodes 100,000。新 queue/early pending は別配列に逃がして合計上限を回避できない。

### 2. 二つの通信面

| 面 | 送受信 | 性質 |
| --- | --- | --- |
| private control | trusted Main runner ↔ native supervisor | window同期制御、非同期load、native event。rendererへ非公開 |
| application IPC | page/preload ↔ native ingress ↔ Main handler | profileで許されたoperationのみ、document authority必須 |

private controlの同期socketpairが動くことはpage/preload間の同期contextBridgeが動く根拠ではない。`ipcRenderer.sendSync` は初期unsupportedを保持する。

#### 2.1 ingress処理順

1. native callback由来のWebView/controller/world/frame/navigation情報を取得する。
2. current session/window/documentとprofile別のrequired observationsを照合する。restricted-originalはload/attestation join、adaptedは0007/0009のDocumentIngressReady。閉鎖中・失効・子frame・許可外worldをrejectする。
3. payload外のnative identityから内部 `SenderContext` を構成する。payload内のsender/window/origin/generationは認証に利用しない。
4. operation/channel、argument schema、path等のcapability、payload byte/depth/node budgetを検証する。
5. listener/handlerの存在とrequest capacityを確認する。`handleOnce`の消費は全admission成功後、callback実行前とする。
6. coreへrequest ticketを登録し、Main realmのcallback IDへ配送する。
7. completionはticketの生存を先に確認してからresultをinspect/encodeし、終端直前にも再検証する。
8. 元document・frameにだけreplyする。navigation/crash後の旧replyは破棄し、new documentへ転送しない。

負例で拒否されたrequestがhandlerを呼ばない、one-shot handlerを消費しない、ファイル等に副作用を起こさないことを観測する。

#### 2.2 Adapted first callとlocal event

Mojiの初回getSettings/getUpdateStateは、native ingressが準備されるまで **Main admission前のbounded queue** へ置く方式を採る。call時に引数をaccepted codecでsnapshotし、queueの件数・累積wire bytes・ready deadlineをmanifestへ固定する。値を後から参照してcall時と違う内容を配送しない。timeout/revokeでPromiseを一度だけrejectし、handler/handleOnceを消費せず、late readyで再送しない。queueから出す時もactual native sender・generation・operation・capacityを再検証する。

nativeのmanifest固定event routeとpage-local listener tableは別ownerである。MojiのonXは同期local登録/同期disposer、配送は非同期とし、個別登録ごとにnative subscribe/unsubscribe ACKを要求しない。登録recordの解除、進行中emissionのsnapshot/reentrancy、同じcallbackの重複は0007のoracle契約へ揃える。native routeが準備できなければ起動診断とpending RPCで失敗を可視化し、local登録成功だけでevent delivery成功としない。

### 3. 公開APIの契約

| API | 保持する振る舞い | 初期制限 |
| --- | --- | --- |
| `ipcMain.on/once/off/removeListener` | 登録順、重複、most-recent remove、nested once、throw | PR #9のordinary string channel subset |
| `ipcMain.handle/handleOnce/removeHandler` | 重複登録拒否、captured in-flight handler、thenable/Promise | callable handlerのみ。全EventEmitter APIと混同しない |
| `ipcRenderer.invoke` | Promise返却、args/resultコピー、error/reject、取消 | accepted codecのみ。同期IPCなし |
| `ipcRenderer.send` | 非同期配送、document sender、順序 | 成功ACKはhandler副作用完了の保証ではない |
| `webContents.send` | 生存する対象documentへの配送 | 全window broadcastや別frameへ黙って転送しない |
| `on/removeListener` renderer側 | 同じrealmの関数identity、登録解除、reload cleanup | 関数本体をserializeしない |
| `event.sender` | hostが作るwebContents facade | 任意のcaller objectから作らない |
| `event.reply`, `senderFrame` | 正しい発信frameへの返信・寿命 | 実装/実証までunsupported。top frameに置換しない |

main-local `emit()` のtrusted JS objectとrenderer由来cloneを分ける。公開 `ipcMain` にnative driver、grant、raw sender constructor、internal invoke controllerを露出しない。

### 4. 値codecとcontextBridgeを分ける

contextBridgeは関数proxy・コピー/凍結、IPCはStructured Clone系の値転送であり、共通JSONシリアライザーだけで両方を満たさない。

| 段階 | codec | 保証範囲 |
| --- | --- | --- |
| 現main | `tiny-json-tree-v1` | plain enumerable record、dense array、有限数等。undefined/alias/cycle等を拒否 |
| PR #12 | `invoke-json-undefined-v1` | tagged variantでtop-level/array/recordのundefinedを保持。全Structured Cloneではない |
| 次の必要subset | versioned explicit codec | 実アプリが要求するBuffer/ArrayBuffer/typed array等を一型ずつ追加 |
| 将来拡張 | graph/transfer profile | Date/Map/Set/cycle/alias/transfer。別予算とoracleを要する |

#### 4.1 undefined tagged variant

内部tagと利用者recordを区別するdiscriminated envelopeを使い、`__proto__`、constructor、prototype、tagと同名のuser keyを通常のデータとして扱う。objectを組み立てる際にprototype setterを呼ばない。欠損field、undefined、null、array holeは異なる。

#### 4.2 Binaryと大きい値

1. byte length、offset、element type、endianness前提を明記し、bufferのcopy/共有/transferを区別する。
2. 初期はcopyのみとし、detachmentやtransferを提供していない場合は明示rejectする。
3. 1 MiBのmessage上限を越えるfileは、public IPCを黙って分割しない。Main file brokerや別のbounded stream APIをprofileに追加してから使う。
4. encode時の一時copyとdecode allocationもbudgetに課金し、wire byteだけでmemoryを見積もらない。
5. source engineでProxy/accessorを安全に扱える根拠がないときは、pure JSでtrapなし検査ができると仮定しない。[0007](0007-context-bridge-feasibility-and-security.md)のengine能力gateに従う。

#### 4.3 Error

同期throw、Promise reject、unsupported argument、clone failure、lifecycle cancellation、transport deathを別内部reasonにする。外部のError形状・messageは固定Electron oracleの範囲を再現し、独自診断をstackやsecretを含む生Errorとしてrendererへ渡さない。

PR #12のbounded message profileを最初に保持し、Error prototype/name/stack/custom propsを対応済みとしない。malicious accessorをもつerror、thenableのgetter、reject after navigationを別fixtureにする。

### 5. 順序と再入

1. 同一sender/document/channelのaccepted message順を保持する。異なるprocess/lane/channelを一つのwall-clock順へ並べ替えない。
2. request受付時にhandlerをcaptureし、remove/re-registerで進行中handlerを別関数へ差し替えない。
3. listener emitは開始時snapshotを採り、emit中の登録/削除がその周回に与える影響をPR #9契約へ揃える。
4. `handleOnce`はnested invocationでも一回だけ消費する。拒否requestは消費しない。
5. JS callbackが同期でwindowをdestroy/quitしても、完了時にcaptured ticketを再確認する。
6. never-settling Promiseの寿命はrequest予算とnavigation/stopで制御する。transport watchdogを任意handlerの短いtimeoutへ転用しない。
7. callbackから同期native getterが呼ばれても、UI hostが同じMainの非同期応答待ちを保持しない設計を試験する。

### 6. Backpressureと終端

| 資源 | admission | 解放条件 |
| --- | --- | --- |
| pending request | coreの256枠とqueue byte | reply成功/error/cancelの一度だけ |
| invoke ticket | PR #11/#12の別256枠 | owner ack/dispose、外部cancel drainで回避させない |
| listener/handler | profile別登録数 | remove/once消費/realm disposal |
| reply buffer | encode前に予算予約 | delivery/cancel/transport close |
| native event queue | byte/件数上限 | coreがconsume/terminal |
| JS root | handleに課金 | deregister/settled/disposeの明示解放 |

budget超過を「message dropしたが成功」にしない。overflow reason、affected sender、queue depthを内容を含めず記録する。巨大な攻撃requestが他windowの正常closeを妨げないようcontrol laneに独立した有限の処理余地を確保する。window単位の公平性とruntime合計上限の両方を試験する。

「exactly once」はlocal terminal bookkeepingの意味に限定する。remote side effectが完了した直後のchannel断では結果が不明になり得る。自動retryでfile write、URL open、handler呼出しを重複させない。

### 8. 分割PR / 完了条件

1. #9→#11→#12のmain kernelを統合し、旧oracle/facadeの回帰を保つ。
2. native ingressの拒否専用pathとbounded parserを追加する。この時点ではapp IPC未対応と表示する。
3. profile別bootstrap/installation/load observationsとgrantを接続し、一つのinvoke operationを実rendererで通す。
4. listener/send/replyとvalue追加を別PRで行い、scope別matrixを更新する。
5. QuickJS realm adapterを同じcoreへ接続し、Node-backedと独立して受入を行う。

完了にはactual native ingressのpositive/negative、全request終端、value/lifetimeのoracle比較、Node-less native実行を要する。strict contextBridgeの完了条件はこのissueから推定せず0007に従う。

## 受け入れ条件

### 最初の slice と production gate

- [ ] native identity がない request を admission へ渡すと、`Denied`、handler count 0、handleOnce/ticket 消費 0 を観測できる。
- [ ] schema が妥当でも stale epoch / foreign window / scope 超過の request は、ファイル操作・Main callback に到達しない。
- [ ] 既存 core の容量回帰では、上限丁度を受理し次の 1 件を拒否する。未配送取消を drain するまで容量を不正回復しない。この synthetic admission の成功を native sender の証明としない。
- [ ] 取消済み ticket への late completion、または発行されていない ticket の completion は、生存確認前に result の getter/thenable を inspect/encode せず、別 ticket も終端化しない。
- [ ] 後続の actual native positive 経路は、0007/0011 の identity gate と下表を同一 SHA/profile/source で実行した native evidence が揃って初めて production 接続完了とする。

下表の synthetic/fake 実行は contract のみを証明し、native sender の実証に代用しない。

### 7. 受入matrix

| What | 正常系 | 故障・攻撃系 |
| --- | --- | --- |
| sender | actual WKWebViewから1request/1reply | payload spoof、他window、subframe、外部document、旧generation |
| grant | native認可済operationだけ配送 | ungranted channel、revoked file、scope越え |
| values | nested undefined、literal tag、copy独立性 | undefined消失、getter/Proxy/cycle、oversize、invalid Unicode |
| handlers | sync/Promise/thenable、once、remove | 重複、capacity満杯、取消後のlate result |
| listeners | duplicate/remove/nested emit | 改変wrapper、throw、停止後のlistener leak |
| lifecycle | reload・close後に次documentを開始 | old reply到着、crashとresolve競合、同token再送 |
| limits | 上限丁度を受理、次を拒否 | fragment/truncation、queue flood、unbounded root |
| equivalence | 同じreal IPC fixtureを両runtimeで実行 | synthetic driverしかないのにnative-equivalentと表示しない |

fixtureはstep ID、開始/accepted/terminal、source hashes、native sender observation、core decision、handler invocation countを記録する。secret/実ファイル本文はログへ載せない。

## テスト計画

| command / 手順 | 前提・検証する範囲 | 今回 |
| --- | --- | --- |
| `node --test tests/clone.test.cjs` | 現 tiny codec の Unicode、getters/toJSON、Node 固有 Proxy 検査、bounds | NOT RUN |
| `moon test --target js`、`moon test --target native` | 固定 MoonBit。grant/generation/pending と追加 admission contract | NOT RUN |
| `npm run build` の後に `node --test tests/core-integration.test.cjs tests/facade.test.cjs tests/transport.test.cjs` | Node-API headers/toolchain、compiled core。Main/facade/private transport の回帰 | NOT RUN |
| native-ingress positive/negative runner | 実装 PR で command を追加する。actual WKWebView、QuickJS runner、EP-15 の document proof が前提 | NOT RUN |

`tests/clone.test.cjs` の unsupported values、proxy traps、aggregate byte limits と、`core/runtime_wbtest.mbt` の grant/取消上限を読み直した。`clone.cjs` は finite number のうち `-0` も拒否し、Node の `util.types.isProxy` を使う。これを QuickJS/JSC の trap-free 能力へ移植済みとはしない。今回の文書整備では runtime tests を実行していない。

## リスク

最大のリスクは不正 request が Main に入ること、失効済み結果の検査が副作用を起こすこと、cancel/reply 二重消費、queue の二重台帳で上限を逃れることである。Control lane の有限な処理余地と document/runtime 両方の公平性を守る。timeout は remote side effect の取消ではなく、結果不明を記録して自動再送しない。

## 未解決の質問

| 未決事項 / blocked scope | Owner role | 必要な根拠・再開条件 |
| --- | --- | --- |
| load 前の actual sender/current document の認可。production positive admission のみ保留 | native / security | 0007 N16〜N21 と0011 native identity、EP-15→EP-14 の証跡。拒否専用 contract は先に実装可能 |
| JSC/QuickJS の Proxy/accessor/thenable を扱う codec の安全な検査範囲。該当値の拡張だけ保留 | engine / codec | engine API と source-realm trap/side effect の fixture。検証できる型だけを versioned profile に採用 |
| ready deadline と per-document queue の初期既定。実appの待ち時間 contract 確定をB3で判断 | core / app | call時snapshot・明示quota・timeout負例、Moji初回trace。実装は有限値を引数として先行し、製品manifest公開前に数値固定 |

## 変更履歴

- 2026-10-17: polish-issue に合わせ、拒否専用 admission の初回 slice、native identity の依存、既定 limits、既存 source/tests と実行 command、codec/queue の限定的な未解決範囲を追加した。旧 §1〜§9 と全受入行を保持した。 runtime/API の実装変更や互換状態の昇格は行っていない。

## 注記

### 準備状態・格納先・確認基点

拒否専用の core/codec/queue contract と PR 統合回帰は着手可能。実 renderer positive の gate は native identity の確認後に進める。Node-less 未実装であること自体を、定義済みの contract 着手を止める質問にしない。

`Status: open` と `issues/open` は、[AGENTS.md](../../AGENTS.md) の「runtime の受入まで issue を open に保つ」規約と、今回の指定格納先に合わせる。整備済みの初回作業は着手してよく、未知の実験結果や後続実装の未完成だけを調査開始の blocker にしない。`polished` への移動や新しい保留状態は追加しない。将来の状態変更は同規約の受入と状態遷移を確認し、元状態 `open`・復帰先 `issues/open/0010-ipc-values-and-flow-control.md` を基準に判断する。

Branch は最初の実装 PR の候補名である。今回の本文整備は main 向けで、ブランチ作成済みという意味ではない。旧番号付き節を小見出しとして保持したため、既存の § 番号と fixture ID を引き続き参照できる。

文書の取得基点は main `8177cf051976b8d7b9eca25ae7ad8820bb04a719`。2026-10-17 の runtime 調査基点 `30c6fc97186e7ecfc8397c799525f00c8e4f0f65` と既存 PR の固定 HEAD は、履歴上の根拠として維持する。本文の公式文書引用は contract の参照であり、実装済み・native PASS の代用ではない。

### 9. 出典

1. [PR #9](https://github.com/f4ah6o/electron.mbt/pull/9)、[PR #11](https://github.com/f4ah6o/electron.mbt/pull/11)、[PR #12](https://github.com/f4ah6o/electron.mbt/pull/12)、[PR #13](https://github.com/f4ah6o/electron.mbt/pull/13)。HEADとCIは0005。
2. [Electron ipcRenderer](https://www.electronjs.org/docs/latest/api/ipc-renderer)、[ipcMain](https://www.electronjs.org/docs/latest/api/ipc-main)、[contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)。固定oracleとの検証前にlatest文書だけでverifiedにしない。
