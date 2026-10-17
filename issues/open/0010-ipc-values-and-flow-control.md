# 0010: IPC ingress・値転送・backpressureの実装設計

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / main-local kernelを実rendererへ接続する計画 |
| 優先度 | P0 |
| 既存作業 | PR #9 listener、#11 invoke、#12 undefined codec、#13 native attestation |
| 依存 | [0006 architecture](0006-runtime-architecture-and-profiles.md)、[0007 bridge](0007-context-bridge-feasibility-and-security.md)、[0009 host](0009-native-host-lifecycle-and-processes.md) |
| 検証 | [0015 evidence/CI](0015-oracle-ci-and-evidence.md) |

## 1. 現在できる部分と新規実装

PR #9はmain-local EventEmitter subset、#11/#12はtrusted synthetic host metadataから呼ぶinvoke kernelを実装する。PR #13はisolated preload成功のnative eventであり、renderer requestのingressではない。したがって既存kernelのequivalentを、実 `ipcRenderer`、native sender認証、実アプリ互換の証拠にしない。

本issueは既存kernelを再利用し、実documentから許可operationをMainへ配送し、値/例外/取消/順序を正しく返す経路を作る。strictとadaptedで公開面は別にする。listenerを登録しただけでrendererへchannel権限を発行しない。

## 2. 二つの通信面

| 面 | 送受信 | 性質 |
| --- | --- | --- |
| private control | trusted Main runner ↔ native supervisor | window同期制御、非同期load、native event。rendererへ非公開 |
| application IPC | page/preload ↔ native ingress ↔ Main handler | profileで許されたoperationのみ、document authority必須 |

private controlの同期socketpairが動くことはpage/preload間の同期contextBridgeが動く根拠ではない。`ipcRenderer.sendSync` は初期unsupportedを保持する。

### 2.1 ingress処理順

1. native callback由来のWebView/controller/world/frame/navigation情報を取得する。
2. current session/window/documentとprofile別のrequired observationsを照合する。restricted-originalはload/attestation join、adaptedは0007/0009のDocumentIngressReady。閉鎖中・失効・子frame・許可外worldをrejectする。
3. payload外のnative identityから内部 `SenderContext` を構成する。payload内のsender/window/origin/generationは認証に利用しない。
4. operation/channel、argument schema、path等のcapability、payload byte/depth/node budgetを検証する。
5. listener/handlerの存在とrequest capacityを確認する。`handleOnce`の消費は全admission成功後、callback実行前とする。
6. coreへrequest ticketを登録し、Main realmのcallback IDへ配送する。
7. completionはticketの生存を先に確認してからresultをinspect/encodeし、終端直前にも再検証する。
8. 元document・frameにだけreplyする。navigation/crash後の旧replyは破棄し、new documentへ転送しない。

負例で拒否されたrequestがhandlerを呼ばない、one-shot handlerを消費しない、ファイル等に副作用を起こさないことを観測する。

### 2.2 Adapted first callとlocal event

Mojiの初回getSettings/getUpdateStateは、native ingressが準備されるまで **Main admission前のbounded queue** へ置く方式を採る。call時に引数をaccepted codecでsnapshotし、queueの件数・累積wire bytes・ready deadlineをmanifestへ固定する。値を後から参照してcall時と違う内容を配送しない。timeout/revokeでPromiseを一度だけrejectし、handler/handleOnceを消費せず、late readyで再送しない。queueから出す時もactual native sender・generation・operation・capacityを再検証する。

nativeのmanifest固定event routeとpage-local listener tableは別ownerである。MojiのonXは同期local登録/同期disposer、配送は非同期とし、個別登録ごとにnative subscribe/unsubscribe ACKを要求しない。登録recordの解除、進行中emissionのsnapshot/reentrancy、同じcallbackの重複は0007のoracle契約へ揃える。native routeが準備できなければ起動診断とpending RPCで失敗を可視化し、local登録成功だけでevent delivery成功としない。

## 3. 公開APIの契約

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

## 4. 値codecとcontextBridgeを分ける

contextBridgeは関数proxy・コピー/凍結、IPCはStructured Clone系の値転送であり、共通JSONシリアライザーだけで両方を満たさない。

| 段階 | codec | 保証範囲 |
| --- | --- | --- |
| 現main | `tiny-json-tree-v1` | plain enumerable record、dense array、有限数等。undefined/alias/cycle等を拒否 |
| PR #12 | `invoke-json-undefined-v1` | tagged variantでtop-level/array/recordのundefinedを保持。全Structured Cloneではない |
| 次の必要subset | versioned explicit codec | 実アプリが要求するBuffer/ArrayBuffer/typed array等を一型ずつ追加 |
| 将来拡張 | graph/transfer profile | Date/Map/Set/cycle/alias/transfer。別予算とoracleを要する |

### 4.1 undefined tagged variant

内部tagと利用者recordを区別するdiscriminated envelopeを使い、`__proto__`、constructor、prototype、tagと同名のuser keyを通常のデータとして扱う。objectを組み立てる際にprototype setterを呼ばない。欠損field、undefined、null、array holeは異なる。

### 4.2 Binaryと大きい値

1. byte length、offset、element type、endianness前提を明記し、bufferのcopy/共有/transferを区別する。
2. 初期はcopyのみとし、detachmentやtransferを提供していない場合は明示rejectする。
3. 1 MiBのmessage上限を越えるfileは、public IPCを黙って分割しない。Main file brokerや別のbounded stream APIをprofileに追加してから使う。
4. encode時の一時copyとdecode allocationもbudgetに課金し、wire byteだけでmemoryを見積もらない。
5. source engineでProxy/accessorを安全に扱える根拠がないときは、pure JSでtrapなし検査ができると仮定しない。[0007](0007-context-bridge-feasibility-and-security.md)のengine能力gateに従う。

### 4.3 Error

同期throw、Promise reject、unsupported argument、clone failure、lifecycle cancellation、transport deathを別内部reasonにする。外部のError形状・messageは固定Electron oracleの範囲を再現し、独自診断をstackやsecretを含む生Errorとしてrendererへ渡さない。

PR #12のbounded message profileを最初に保持し、Error prototype/name/stack/custom propsを対応済みとしない。malicious accessorをもつerror、thenableのgetter、reject after navigationを別fixtureにする。

## 5. 順序と再入

1. 同一sender/document/channelのaccepted message順を保持する。異なるprocess/lane/channelを一つのwall-clock順へ並べ替えない。
2. request受付時にhandlerをcaptureし、remove/re-registerで進行中handlerを別関数へ差し替えない。
3. listener emitは開始時snapshotを採り、emit中の登録/削除がその周回に与える影響をPR #9契約へ揃える。
4. `handleOnce`はnested invocationでも一回だけ消費する。拒否requestは消費しない。
5. JS callbackが同期でwindowをdestroy/quitしても、完了時にcaptured ticketを再確認する。
6. never-settling Promiseの寿命はrequest予算とnavigation/stopで制御する。transport watchdogを任意handlerの短いtimeoutへ転用しない。
7. callbackから同期native getterが呼ばれても、UI hostが同じMainの非同期応答待ちを保持しない設計を試験する。

## 6. Backpressureと終端

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

## 7. 受入matrix

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

## 8. 分割PR / 完了条件

1. #9→#11→#12のmain kernelを統合し、旧oracle/facadeの回帰を保つ。
2. native ingressの拒否専用pathとbounded parserを追加する。この時点ではapp IPC未対応と表示する。
3. profile別bootstrap/installation/load observationsとgrantを接続し、一つのinvoke operationを実rendererで通す。
4. listener/send/replyとvalue追加を別PRで行い、scope別matrixを更新する。
5. QuickJS realm adapterを同じcoreへ接続し、Node-backedと独立して受入を行う。

完了にはactual native ingressのpositive/negative、全request終端、value/lifetimeのoracle比較、Node-less native実行を要する。strict contextBridgeの完了条件はこのissueから推定せず0007に従う。

## 9. 出典

1. [PR #9](https://github.com/f4ah6o/electron.mbt/pull/9)、[PR #11](https://github.com/f4ah6o/electron.mbt/pull/11)、[PR #12](https://github.com/f4ah6o/electron.mbt/pull/12)、[PR #13](https://github.com/f4ah6o/electron.mbt/pull/13)。HEADとCIは0005。
2. [Electron ipcRenderer](https://www.electronjs.org/docs/latest/api/ipc-renderer)、[ipcMain](https://www.electronjs.org/docs/latest/api/ipc-main)、[contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)。固定oracleとの検証前にlatest文書だけでverifiedにしない。
