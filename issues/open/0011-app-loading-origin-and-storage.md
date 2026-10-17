# 0011: アプリロード・origin・ファイル権限・永続データ設計

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / 実アプリの起動・保存を成立させる設計 |
| 優先度 | P0 |
| 基盤 | main app-files inventory、PR #2 loadFile、PR #4 userData分離 |
| 依存 | [0006](0006-runtime-architecture-and-profiles.md)、[0009](0009-native-host-lifecycle-and-processes.md)、[0010](0010-ipc-values-and-flow-control.md) |
| 関連 | [0008 loader](0008-nodeless-runtime-and-module-loader.md)、[0014 実アプリ](0014-real-app-acceptance.md)、[0016 配布](0016-packaging-release-and-updates.md) |

## 1. 現状のinventoryの限界

`bridges/node/app-files.cjs` はroot内のsource、symlink target、size/hashを記録し、stable root escape/cycle、巨大入力、一部の同時変更を検出する。READMEが明記する通り、atomic filesystem snapshotでも攻撃者が変更するfilesystemに対するsecurity boundaryでもない。

製品packはtrusted/quiescent sourceからprivate staging snapshotを作り、manifestと共に不変に固定する。実行時に元working treeを何度もresolveして、その都度違うsourceを実行する構成を既定にしない。dev modeで変更を許す場合は各reloadのrevisionを新しいgeneration/evidenceとして扱う。

## 2. ロードpipeline

1. app manifest、profile、main entry、prepared assets、production dependenciesを読取専用で検査する。
2. `main`、`preload`、renderer assets、lockfile、build config、adapterそれぞれのhashを採る。
3. package graphとNode/Electron symbol inventoryを作成し、トップレベルimportの未解決をrun前に診断する。
4. stageは同じfilesystem上のprivate directoryへ書き、全file hash一致後にsealする。途中失敗は未公開stageだけを片付ける。
5. native hostとrunnerは同じstage manifest hashをhandshakeする。
6. runtimeはreadonly app assetsとwritable app dataを別rootで開く。app sourceを書き換えてloaderを通さない。
7. resource lookup、preload、module requireを同じ解決policyへ接続するが、権限の役割は別とする。

ASAR archiveは初版unsupported。偶然見つかった `.asar` をdirectoryと同じ扱いにしない。将来のarchive readerは圧縮爆弾、path traversal、symlink、nested archive、integrityの独立issueとして追加する。

## 3. `loadFile`・URL・storage origin

### 3.1 originを偽らない

strict `loadFile` では実際の `file:` URL、query/hash、相対asset、CSP、CORS、storageの観測をElectronと比較する。内部custom scheme/localhostへ変更したならURL/originの差をprofileへ記録する。file URLのopaque/null originを架空のHTTPS originに置き換えて互換と表示しない。

現行core `activate_document` は空文字/`null` originを拒否する。この文字列を機械的にtrustedへ変更するのではなく、native source identityの型を追加する。

| 内部identity案 | 認証情報 | pageへ見せるlocation |
| --- | --- | --- |
| `LocalFileDocument` | app snapshot ID、native WebView、canonical entry、generation | 実際のfile URL |
| `AllowedWebDocument` | native security originのtuple/opaque/inherited属性、native frame、navigation identity、独立したfinal URL policy | 実際のURL |
| `AdaptedAppOrigin` | explicit profileのresource handler、app ID、generation | 変更したschemeを正直に表示 |

これはauthorization用の内部型であり、Web標準originを書き換える仕組みではない。HTTPS URLでもCSP sandbox等でoriginがopaqueになり得るため、WKFrameInfo.securityOrigin等のnative観測とfinal URLのnavigation policyを分ける。opaque/inherited originは初期特権denyとし、例外を追加するなら親realmの継承規則と実native観測を別fixtureで証明する。native APIで必要な属性を観測できなければURL一致へ降格せずblockedにする。どのoriginでもnative frame/documentの照合を省略しない。

### 3.2 navigationとresource policy

| 種別 | 初期policy | 必須試験 |
| --- | --- | --- |
| MainのloadFile | app snapshot内のregular file | query/hash、非ASCII、missing、redirect、二重load |
| rendererのmain-frame navigation/reload | Node-backed既存の許可済same-file reloadを保持。新productではprofile別に許可し、実document replacementだけ新generationへ | 同path reloadは新世代、same-document history/hashは既存世代、back-forward restoreの寿命は別試験 |
| subframe | 表示可否と特権可否を分け、初期特権deny | same-origin、cross-origin、srcdoc、about:blank |
| popup / window.open | 初期denyまたは型付き外部open policy | frame spoof、target=_blank、opener |
| remote subresource | app別allowlist/CSP、local-only試験では遮断 | HTTP redirect、mixed content、websocket、tracker |
| download | 専用OS service経由までdeny | filename traversal、cancel、サイズ、permission |
| custom protocol | 別受入までunsupported | jmdのbypassCSP要求を黙って捨てない |

trusted local mainから指定されたURLでもrendererは任意の特権を得ない。外部リンクを開く前にscheme/host policyを確認する。DOM可読nonceやURL一致だけで認証しない。

## 4. ファイルbrokerの権限モデル

Mainはインストールされた信頼済アプリprincipalとして扱う。rendererは無権限で、native ingressが操作・window・document・対象path/grantを検証してからMainへ渡す。

未改修の `fs.readFile(path)` にはdocument/grant引数がない。QuickJSにNode AsyncLocalStorageがあるとは仮定せず、global `currentSender` を非同期handler間で共有しない。

1. renderer-origin operationは、native ingressで現在documentのcapabilityとargumentを検証する。
2. Mainのfs shimはapp principalでbrokerへ要求する。brokerはreadonly snapshot、当該app data、明示的に承認されたfile領域の範囲を再検証する。
3. navigationでrenderer authorityを失効する。Mainが既に開始したfile operationや保持するapp-level grantを自動的に巻き戻したとは扱わない。
4. 全fs callをrequest/document-boundにしたい場合、Promise/job/timerを跨ぐauthority context伝播と対象アプリ適応を別gateで設計する。
5. 任意 `readPath` のpath stringを認証済みとして転送しない。open/save/recent-fileごとにgrantsと許容操作を固定する。

この制約はElectron Mainの一般的なOS file権限と同一ではない。Node-less profileの追加policyとして表示する。

### 4.1 FileGrant案

| field | 内容 |
| --- | --- |
| owner | app instance + session、必要時window/document |
| object | descriptor/OS bookmark/file identity。renderer文字列のみを正本にしない |
| rights | read / create-new / replace-selected / enumerateを別々に |
| write behavior | `node-write-file` / 明示した `atomic-replace-v1`。権限の有無と書込方式を分ける |
| lifetime | operation / document / app session / explicit persisted |
| provenance | native open/save dialog、利用者の明示的再許可 |
| revocation | window/doc失効、app停止、明示解除、予期しない対象置換。認可済atomic saveのidentity更新は別transaction |
| bounds | 最大file byte、read/write byte、open descriptor数 |

初期M2/M3はtemporary test directory内の対象fileに限定する。Mojiの通常 `file:save` はsave dialogを開かず `fs.writeFile` を呼ぶため、saveAsだけを認可しても日常保存は成立しない。初期adapted profileではnative openを **open-for-edit** として提示し、選択したregular fileにread + replace-selectedのapp-session grantを発行する。readonly guide・単なるread grant・rendererが申告したpathへwrite権限を昇格しない。この権限policyと保存方式はadapter manifestへ記録する。

| 利用者操作 | 発行・再確認する権限 | 続く保存 |
| --- | --- | --- |
| open-for-edit | native pickerで選択した各fileのread + replace-selected | 同sessionの通常saveは再dialog不要。対象identityとgrantを毎回再検証 |
| readonly open / guide表示 | readのみ | 同path上書き拒否。saveAsで別対象を選択 |
| 新規saveAs | create-newまたは選択既存pathのreplace-selected | 成功後は当該fileのread + replace-selectedへ更新 |
| 再起動後のrecent-file | 初版はpicker等による再許可 | 前sessionのpathだけでwrite grantを復元しない |
| 将来のpersisted bookmark | 利用者が許可したlifetimeと再検証 | 移動・権限拒否・失効時は再許可。追加gateまで未対応 |

最初の再起動試験は保存fileをpickerから再openして通常saveする。promptなしのrecent-file復元を必要とする段階で永続bookmarkを追加する。

## 5. path・TOCTOU・保存の実装

1. string prefixだけでroot内判定しない。OSのdirectory handleを基点にpath componentを解決し、symlink/reparse point・mount・特殊fileを検査する。
2. `realpath` した後に同じpathを再openするだけではraceが残る。開いたdescriptorのidentityと認可対象を照合する。
3. file以外のFIFO/device/socketを拒否し、read待ちでUI/event loopを停止させない。
4. NUL、無効encoding、Windows drive/UNC/ADS/reserved name、Unicode表記差をOSごとに扱う。ユーザfile名を無断normalizationしない。
5. Node互換subsetの `fs.writeFile` と製品の安全な保存policyを分ける。通常のtruncate/writeはinode、mode、hardlink、途中失敗の観測を持ち、temporary file + renameとは等価でない。`node-write-file` は対応するflags/encoding/bytes/errorをNode oracleで比較し、失敗時に元dataが必ず残るとは宣言しない。
6. create-newはexclusive作成を使う。replace-selectedは選択したpath名へのatomic replacementと、選択時inode/objectを守るCASを区別する。置換直前のidentity不一致は競合で止めるが、普通のrenameはexpected identity付きCASではなくcheck直後の差替を防げない。初期の強いdata保護試験はprivate test directoryまたは協調writer/排他が成立する範囲で行い、非協調・敵対的writerにも選択時objectを保証する主張は未受入とする。backendに原子的な条件付き置換がある場合だけ、その契約を別試験で追加する。
7. check直後に別writerがtargetを差し替えるfixtureを追加し、検出可能な競合と検出できないwindowを記録する。利用者にはreplace-by-pathと競合保護の範囲を明示する。cancellation前後のcommit pointを記録する。rename後にreplyを失った場合、再writeせず内容hashで照合できる設計にする。
8. 改行、UTF-8、BOM、emoji、日本語、空file、末尾改行をbytesで照合する。

### 5.1 Moji初期adaptedの保存方式

Moji M3の日常保存には **明示した `atomic-replace-v1`** を採用する案とする。app/profile manifestで対象grant、許可したwriteFile signature（最初は通常の文字列/bytes置換）、metadata policyを指定し、Main fs facadeからbrokerへ渡す時点でこの差を診断・evidenceへ残す。汎用Node subsetの既定に隠して入れず、任意flags/descriptor書込へ適用しない。原本Mainのbytesが同じでも、この振舞い差はadaptationである。

このmodeでは同じdirectoryのtemporary fileへwriteし、flushとmetadata policyを満たしてからreplaceする。既存modeを保持できる範囲、新規fileのcreation mode、owner/ACL/xattr/hardlinkへの影響を固定fixtureで記録する。保持できないmetadataを無断破棄して既存fileに使わず、初期受入は通常の単一link test fileへ限定する。permission、容量不足、partial write、fsync失敗をsuccessへ変換しない。

認可済replacementのcommit時にbrokerが新file identityへ当該grantを更新し、次の通常saveを可能にする。reply喪失時もnativeのcommit recordを正本に再照合し、rendererが新identityを申告して権限を更新する方式にしない。外部writerの予期しない差替はこの更新と区別して再許可・競合扱いにする。

rename前の失敗で元file保持を要求できるのは、このmodeと上記の競合保護範囲である。rename後にdirectory flushやreplyが失敗したら、disk上の結果をcommitted/unknownとして検証し、retryで二度置換しない。`node-write-file` の結果をこの強い保証で採点せず、両modeのreadback、metadata、hardlink、crash結果を別reportにする。

## 6. userData・appData・再起動

PR #4は既定userDataを `<appData>/electron.mbt/<name>` へ分離した。PR #2を統合するときに旧既定へ戻さない。ただしMojiはMainで `app.setPath('userData', join(app.getPath('appData'), 'moji'))` を実行するため、既定値だけでは保護できない。

### 6.1 実アプリ受入の初期方針

1. Electron baselineとcandidateを別のdisposable OS userまたは実際に隔離できるdata環境で動かす。プロセスenvでHOMEを書き換えただけの隔離を保証としない。
2. 名前付きtest fixture以外のfile、既存Electron MojiのuserData、一般clipboardを検証後に照合する。
3. product adapted profileでは、明示したappData mappingをlauncher設定で適用できる案を実装・記録する。`app.getPath`の返値差分として公開する。
4. 元Mainがこのmappingを迂回して別pathを指定した場合はbroker policyで拒否し、隠れたredirectをしない。
5. strict data path parityを求める場合は、独立OS userでoracle/candidateの同じpath contractを比較する。

### 6.2 browser storage

PR #2はnonpersistent data storeを使う。日常利用でlocalStorage/IndexedDB/cookie等が必要なら、app/profileに紐付いたpersistent storeを追加し、app間分離と再起動readbackを検証する。WKWebsiteDataStoreの公開APIと対象OS下限で実現できる構成を選び、全appで共有default storeへ暗黙移行しない。

source data、browser store、settings、crash log、cache、update stageのdirectoryを分ける。アプリ削除時に利用者dataを自動削除しない。migration versionとbackup hashを記録し、旧version起動が不可能ならその理由とrestore手順を出す。

## 7. 受入と分割

| What | 受入条件 |
| --- | --- |
| source不変 | Main/preload/assets/build差分が別hashで説明できる |
| path認可 | traversal、symlink差替、特殊file、reparse pointの拒否 |
| 通常保存 | open-for-edit→編集→save、saveAs後の再save、再起動→picker再open→saveが対応grantで完了する |
| file保存 | admission前cancelで副作用なし。atomic modeはrename前失敗で元data保持、rename後ACK喪失はcommitted-or-unknown。Node writeFile modeは独自の失敗・metadata観測と比較 |
| origin | file/custom/remoteの観測差が台帳にある |
| document失効 | 旧renderer grant/replyは拒否。既にacceptedなMainがawait後にapp権限で新writeを開始し得ることを別fixtureで確認し、doc失効をMain副作用の取消と表示しない |
| userData | MojiのsetPath後も既存実dataへの無断変更がない |
| persistent store | 再起動readback、app間分離、version migration/rollback |

実装PRは、source snapshot → origin identity → file broker → persistent storage → real-app保存/復旧の順に分ける。source hash checkerだけでprivileged file service完成としない。

## 8. 出典

1. [main app-files.cjs](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/bridges/node/app-files.cjs)
2. [PR #4 userData修正](https://github.com/f4ah6o/electron.mbt/pull/4)、[PR #2 native resource policy](https://github.com/f4ah6o/electron.mbt/pull/2)
3. [Moji固定main](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/main.ts)
4. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)、[app](https://www.electronjs.org/docs/latest/api/app)、[WKWebsiteDataStore](https://developer.apple.com/documentation/webkit/wkwebsitedatastore)。実装時は対象OS/API availabilityを記録する。
