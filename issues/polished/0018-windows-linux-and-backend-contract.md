# 0018: Windows・Linux backendと共通host契約の実装設計

Status: polished
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: feat/issue-0018-backend-contract

## 概要

**性質:** Windows/Linuxの調査を先行するbackend拡張Issue。**利用者への影響:** 対象OS/runtime版でwindow・file・IME・配布が動く範囲を明示し、portableテストだけでGUI対応と表示しない。

| 項目 | 内容 |
| --- | --- |
| 優先度 | P2。macOS実用preview後の拡張、portable契約調査は並行可 |
| 依存 | [0006 architecture](0006-runtime-architecture-and-profiles.md)、[0009 host](0009-native-host-lifecycle-and-processes.md)、[0015 evidence](0015-oracle-ci-and-evidence.md) |
| 関連 | [0007 bridge](0007-context-bridge-feasibility-and-security.md)、[0016 release](0016-packaging-release-and-updates.md)、[0019 interaction](0019-native-interaction-and-accessibility.md) |

最初の限定作業はcapability schema/fixtureと各OSのpublic API・依存inventory。EP-29/30の製品backend受入はmacOS preview後だが、調査・portable fixtureは先行できる。

## 背景

### 1. Platform順序

最初の製品基準はmacOS Apple Silicon。Linuxでは現在のportable/MoonBit/transport検証を継続し、GUI backendは次段で実装する。Windowsは独立したCOM/WebView2/IME/配布受入を経て追加する。Mac Intelを初期matrixへ増やさない。

Linux/Windows実装を始める条件はmacOSの全strict gate完了ではない。shared protocolとapp/adapted profileが固定されれば着手できるが、macOSのPASSを他OSへ移植してsupportedと表示しない。人が操作できるWindows/Mac環境がない場合、その項目は未実行として残す。

[README](../../README.md)と[manifest](../../compatibility/manifest.json)はWindows/Linux backendを未実装としている。現行 [core tests](../../core/runtime_wbtest.mbt) はportable contract、[transport tests](../../tests/transport.test.cjs)はNode-API socketpair、[macOS probe](../../platform/macos/WKNativeProbe.m) はmacOSの観測である。`platform/windows/` / `platform/linux/` のGUI実装はmainに存在しない。

## 問題

WebViewの名前が似ていても、thread/COM/GTK loop、frame identity、document-start、runtime導入、file picker、IME/AXの契約はOSごとに異なる。macOSのgrant/ready/closeをそのまま別backendの成功値にすると、同期性や隔離・取消・native入力を誤認定する。

LinuxのGTK/WebKitGTK ABIとWindowsのSDK/runtime最小面は対象環境で固定する必要がある。未確定のruntimeを仮定して全OS向け製品コードを完成扱いにせず、schema・最小host・bridge証明・日常操作を段階化する。

## 目標

- 共通host契約をAPI/variant/minimum runtime/evidence単位で表し、未対応呼出しをtyped failureにする。
- 一つのWindows、一つのLinux matrixでactual native window/transport/ownershipを受入する。
- 実frame/document proof、file/storage、IME/AX、配布を各OSの証拠で追加する。
- 未実行・missing runtime・OS差をmanifestとdiagnosticsへ残し、別OSのPASSで補わない。

## 対象外

最初のsliceでの全Windows版・全distro・全display server・全Electron/Node API対応、macOS strict gateの解除、Mac Intel追加、generic gpui埋め込みの完成は含めない。Chromium/Electronの隠れた同梱やruntime無断downloadは採らない。Fixed Version/Flatpak等は明示artifact/profileと追加受入で扱う。

## 提案する方針

### 2. Backend interface案

| contract | native実装責務 | core所有 |
| --- | --- | --- |
| capabilities | API availability、engine version、frame/world能力 | profile admissionとunsupported判定 |
| window | create/show/hide/bounds/focus/close/destroy | IDs、lifecycle、operation correlation |
| navigation | load/finish/fail/redirect/document replacement | generations、grant revocation |
| bridge | realm setup、native callback metadata、reply | sender policy、request budget、protocol |
| services | dialog/file/clipboard/Menu/shell | permission、lifetime、result schema |
| process | owned process/thread/handle観測 | session失敗・資源台帳 |
| storage | app-specific data/store配置 | app/profile分離とmigration policy |

backend capabilityはbool一つにせず、API+variant+minimum runtime+test/evidence IDを持つ。unsupported実装が成功ACKを返すdefault interfaceを用意しない。common contractにOS差を隠すための架空eventを追加しない。

### 3. Windows: Win32 + WebView2 Evergreen

#### 3.1 event loop / COM lifetime

1. UI threadのCOM apartmentを明示し、HWND/WebView controller/environmentを同じ所有規則で生成・解放する。
2. asynchronous environment/controller作成をapp/window stateへ接続し、ready前のcreate cancellation/host lossを試験する。
3. event registration tokenを台帳で管理し、destroy時に解除する。late callbackが新HWND/IDを参照しないようgenerationを確認する。
4. DPI awareness、logical boundsとphysical pixels、parent/child HWND、focusを別契約にする。
5. request/responseはnative IPCのWindows実装へ置換し、POSIX FDのinteger仕様をそのままhandleへ適用しない。

#### 3.2 WebView2のbridge

WebView2のhost objectやweb message APIがElectron contextBridgeをそのまま満たすとは仮定しない。synchronous host objectの再入/JS callback制限、frame/source検証、navigation後handle失効を0007と同じstrict/adapted matrixで試験する。

1. pageから来るsource/window/frame ID文字列をauthorityとしない。
2. main frameとiframeのevent/sourceをnative APIから区別し、許可範囲をprofileへ固定する。
3. AddScript系APIの初回page script前実行、再ロード、subframe適用を実測する。
4. Windowsで一部syncが可能でもmacOS strictを昇格させない。

#### 3.3 配布・managed環境

Evergreenは共有runtimeで自動更新されるが、未導入・オフライン・組織管理で更新停止の環境を扱う。API feature detectionを行い、registry上のversionだけで必要interfaceが使えると断定しない。Fixed Versionを同梱するモードは別artifactで容量/更新責任を記録する。[S1]

| case | 受入 |
| --- | --- |
| Evergreen導入済み | launch/upgrade、actual engine versionを記録 |
| 未導入 | 明確な導入案内、無断downloadなし |
| offline | 同梱依存版またはexplicit failure、総取得量を表示 |
| standard user | user/machine install path、permission、data分離 |
| enterprise proxy | installer/update/networkの許可・拒否を区別 |
| runtime更新 | 次回起動/稼働中versionを区別、compat再検証 |

AuthentiCode/installer/更新は0016のOS別laneとして追加し、Windows UI Automation、日本語IME、clipboard、125/150/200% scaleを0019へ追加する。

### 4. Linux: GTK + WebKitGTK

#### 4.1 最初のplatform matrix

第一候補はUbuntu 24.04系の一つの固定imageとWayland session。具体的WebKitGTK/GTK ABI versionは利用可能なpackageと公開APIを調査してpinする。X11/XWaylandは別lane。Linuxのheadless portable testsがPASSでもGUI対応とは呼ばない。

1. GTK main loopがUI objectを所有し、QuickJS/Main同期callがこれを止めないようprivate transportを接続する。
2. user content manager/world/script messageの公開APIをversion別に確認し、native sender identityが不足する場合はそのbridge profileをblockedにする。
3. Web process sandbox、display server、D-Bus/portal、fonts、locale、IME moduleの依存を明示する。
4. clipboard/selection、native file chooser/portal、window activation、fractional scaleを実操作で比較する。
5. package availabilityを調べずsystem WebKitが全Linuxにあると仮定しない。

#### 4.2 gpuiとGTKの関係

初期はstandalone GTK/WebView hostとしてcommon protocolに接続する。gpui Linux window内への埋め込みを必須にする場合、GTKとgpuiのevent loop、native surface、focus/teardownの公開契約を小fixtureで実証してから統合する。複数UI loopの安易なnested pollingで動作したことを受入にしない。

#### 4.3 packaging

deb/rpm/portable等の形式は対象distro実験後に選ぶ。WebKitGTK共有libraryを外部依存にする場合、minimum ABI、導入command、cold download、security updatesの担当をmanifestへ記す。Flatpak/portal等を採る場合はfile grant/storage/URL handlerのprofile差を追加する。未検証のAppImageで全distro対応と表示しない。

### 最初の限定PRと実装場所

| 段階 | 変更対象 | 出口 |
| --- | --- | --- |
| capability contract | `compatibility/`のschema、`core/`のadmission、platform fixture（新規） | unsupported/minimum runtime/unknown evidenceをtypedに区別。fake成功ACKを作らない |
| OS入力固定 | Windows SDK/WebView2 runtime・Linux image/GTK/WebKitGTK/Waylandのmanifest（新規） | API availability/導入/更新責任と取得hashを記録 |
| 最小host | `platform/windows/`、`platform/linux/`（新規）、共通transport/core adapter | create/query/close/partial-create failure、thread/handle/FD解放 |
| 後続production | 0007/0011/0012/0014/0016/0019のOS別adapter | actual sender→Main→file→reply、日常操作、署名/配布 |

最初のPRはschema・不正capability報告の拒否・実装対象ABIの調査に限定する。main既存POSIX FDのABIをWindows handleへコピーせず、platform-specific handleをnative leaf内へ閉じ込める。common公開型/`.mbti`/wireを変える場合は旧macOS/Node-backed fixtureとmigrationを同じPRで維持する。

### 6. 分割PR / 完了条件

1. shared backend capability schemaとfake contractを実装する。
2. Linux/Windowsそれぞれ最小native windowとprivate transportを追加する。
3. loader/window/lifecycle、isolated bridge、native IPCを段階接続する。
4. OS services・storage・実app・interactive・packagingを独立laneで受入する。
5. 対象OS/CPU/WebView versionとprofileだけをsupported matrixへ追加する。

各OSはA-Jのrequired subsetを自分のevidenceで満たす。compile-only、WindowsでのLinux container試験、別OSのスクリーンショットをnative互換証拠にしない。

## 受け入れ条件

- [ ] Given unknown/missing runtimeまたは未検証capability, when backend admissionする, then 原因付き拒否またはnot-runとなり、成功ACK/supportedを生成しない。
- [ ] Given pinしたOS/CPU/runtime, when native windowのcreate/query/closeと部分生成失敗を実行する, then 実window状態・event・owned handle/FD台帳が一致する。
- [ ] Given same/cross-origin iframe、旧document、fake source ID, when bridgeへ要求する, then actual native identityに基づいて副作用前に拒否される。
- [ ] Given selected app/profile, when open/edit/save/restart/IME/AXをそのOS上で実行する, then file bytesとnative操作が確認され、必要範囲だけsupported matrixへ追加される。
- [ ] Given runtime未導入・offline・standard user環境, when 配布物を起動する, then 明示した導入/失敗経路となり、依存込み取得量と更新責任が記録される。

EP-29/30の8〜15人日 / 10〜18人日という初期案は最初の限定backend sliceだけを指す。全app/全A〜Jの受入は上記の後続作業に分け、scope別に完了を報告する。

## テスト計画

### 5. Cross-platformで共通化する試験

1. MoonBit lifecycle/ID/limits/codecのpure contract。
2. native transportのframing/deadline/replay/correlationとprocess loss。
3. same fixtureによるwindow bounds/load/close/quitの必要なevent先後関係。
4. actual bridgeのframe/document spoof・navigation失効・payload境界。
5. app操作のopen/edit/save/restart、実file bytesとstorage分離。
6. OS固有IME、AX、DPI、Menu/clipboardの独立確認。

expected traceには共通制約とOS固有差を明示し、platformごとに都合のよいexpected値を無記録で増やさない。

| lane | 現存entry / 新規予定 | 実施範囲 |
| --- | --- | --- |
| portable回帰 | `moon check --target js`、`moon test --target js`、`moon test --target native` | core state/codec/limits。OS GUIの証拠ではない |
| 既存Node境界 | 対応hostで `npm run build` 後 `node --test tests/manifest.test.cjs tests/transport.test.cjs` | 現行POSIX Node-API経路の回帰。Windows build対応とは表示しない |
| capability新規 | schema/unknown variant/version mismatch fixtureを既存suiteへ追加 | 必要capabilityを欠くbackendがadmitされない |
| Windows native | COM/STA/controller async failure、HWND再利用、frame proof、DPI/IME/UIA | entryは実装PRで追加。actual Windows GUIとruntime/SDK pinが必要、現時点NOT_RUN |
| Linux native | GTK loop、Wayland、portal、fonts/IME/AT-SPI、WebKit process loss | pin済imageとactual session。X11は別lane、現時点NOT_RUN |
| distribution | runtime absence/offline/standard user、更新前後、cold download | 0016のOS別evidence。containerのcompile成功を実installにしない |

初期contract調査には実行可能なpure fixtureを使い、GUI検証環境が未準備のcaseはNOT_RUNとする。ここに未存在のビルドコマンドやpackage名を確定済みとして書かず、OS入力固定PRでCI/READMEへ同じentryを追加する。

## リスク

| リスク | 対応・停止条件 |
| --- | --- |
| runtime更新で必要API/挙動が変わる | actual version/feature detectionと固定fixtureを再検証、過去のpassedを自動継承しない |
| COM/GTK callbackとMain同期callの相互待ち | owner thread/token/reentryを最小hostで試し、nested pollingで隠さない |
| native senderに必要な情報がない | 該当bridge profileをblockedにし、claimed IDやDOM nonceへ降格しない |
| distributionが依存取得量や保守責任を隠す | Evergreen/Fixed、distro/ABI、cold/installed bytesをartifact別に記録 |
| shared contractの変更がmacOSを壊す | 同じprotocol/schema fixtureと既存OS回帰を実装PRに含める |

## 未解決の質問

| 判断が必要な点 | 判断owner / 必要な証拠 | 再開条件・依存scope |
| --- | --- | --- |
| Linuxの最初のGTK/WebKitGTK ABI・package・Wayland環境をどれに固定するか | Linux backend/release担当。Ubuntu 24.04系候補の実package/API/依存/更新調査 | image/runtime/toolchain pinが揃ってからnative backend実装・配布を受入。capability/portable調査は先行可 |
| Windowsの最小SDK/runtime/interfaceと導入modeはどれか | Windows backend/release担当。Evergreen/Fixed・offline・standard userのAPI/取得量調査 | minimum versionとfeature detection/不足時契約を固定したscopeからnative hostを実装。全managed環境を既定にしない |
| 各WebViewが必要なdirect sender/document/world証拠を提供するか | OS backend担当＋独立security reviewer。0007相当のactual native positive/negative | 同一variantで証拠が揃ったbridgeだけをadmit。不成立でもnative window/transport試験は継続 |

## 変更履歴

- 2026-10-17: ユーザー指示により `issues/open` から `issues/polished` へ移動し、`Status: polished` と現行参照を同期。実装の準備状態・未解決事項・受入証拠は変更していない。

- 2026-10-17: Windows COM/WebView2、Linux GTK/WebKitGTK、common backend、native入力/配布の独立受入を設計。
- 2026-10-17: `polish-issue`で現行portable/Node/macOS probeと未実装OSを照合し、capability調査の限定PR、予定path、具体的な受入・現存command、ABI/runtime判断のownerと再開条件を追加。元のOS別契約・候補・source・節anchorを保持。runtime/対応OSの状態は変更していない。

## 注記

- 2026-10-17: ユーザー指示「mv to issues/polished」に従い、整備済みの計画を open から polished へ移動。未解決事項・依存条件・runtime の未受入は本文に保持する。

- **将来の非blocking候補:** 最初のhostはstandalone GTKとし、gpui埋め込みを初期sliceの前提にしない。release/product担当が利用者要件と公開attach/loop/focusのfixtureから必要性を確認した場合だけ別ADRで追加する。Linuxの配布形式は最初のdistro試験後に0016のOS別配布条件として選び、追加形式のfile grant/storage差を記録する。形式選択の未完をcapability/最小host調査全体の保留理由にしない。

**状態と配置:** 2026-10-17 のユーザー指示により `open` から `polished` へ移動した。現在の保存先は `issues/polished/0018-windows-linux-and-backend-contract.md`。`polished` は計画の整備状態であり、runtime の受入や未解決事項の解消を示さない。着手は本文の準備状態・依存条件に従い、受入は [AGENTS.md](../../AGENTS.md) と各試験の実証で判断する。進捗と再開条件は本ファイルへ記録する。

- **準備状態:** portable capability契約とWindows/LinuxのAPI/依存調査は着手可能。native製品backendは上記ABI/runtime・sender証拠を固定し、0020のmacOS preview後の受入順に従う。全strict macOS成功を前提にしない。
- **再開・記録先:** 未解決事項と後続依存は本文の証拠・担当role・再開条件で判断し、進捗は本ファイルへ記録する。状態を変更するときはmetadataと配置を同時に更新する。
- **ブランチ:** `Branch` の `feat/issue-0018-backend-contract` は実装時の提案名であり、この整備で作成したbranchではない。既存PRの履歴を消さず、小さい統合PRへ分ける。
- **確認基点:** 本整備のmainは `8177cf051976b8d7b9eca25ae7ad8820bb04a719`。初回設計の `30c6fc97186e7ecfc8397c799525f00c8e4f0f65` と各PR/appの固定SHAは履歴根拠として保持する。mainへのPR統合・runtime実装・native E2E完了を意味しない。
- **検証の範囲:** 2026-10-17のpolishはIssueと関連source/testの読取・文書整合を対象とする。下記のruntime/GUI/配布試験は、この本文更新では実行していない。実行する際はcommand、対象SHA、環境とPASS / FAIL / NOT_RUNを別記録にする。

### 7. 出典

1. [S1: WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)、[Evergreen/Fixed](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version)
2. [WebKitGTK API reference](https://webkitgtk.org/reference/) — 使用ABI/APIは実装時に固定。
3. [Issue 0001 OS設計](0001-electron-compatible-lightweight-runtime.md)、[PR #3 macOS-first](https://github.com/f4ah6o/electron.mbt/pull/3)
4. bridge公開APIの一次資料は [0007](0007-context-bridge-feasibility-and-security.md) に集約。

[S1]: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
