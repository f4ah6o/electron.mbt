# 0018: Windows・Linux backendと共通host契約の実装設計

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / Windows・Linux GUI backendは未実装 |
| 優先度 | P2。macOS実用preview後の拡張、portable契約調査は並行可 |
| 依存 | [0006 architecture](0006-runtime-architecture-and-profiles.md)、[0009 host](0009-native-host-lifecycle-and-processes.md)、[0015 evidence](0015-oracle-ci-and-evidence.md) |
| 関連 | [0007 bridge](0007-context-bridge-feasibility-and-security.md)、[0016 release](0016-packaging-release-and-updates.md)、[0019 interaction](0019-native-interaction-and-accessibility.md) |

## 1. Platform順序

最初の製品基準はmacOS Apple Silicon。Linuxでは現在のportable/MoonBit/transport検証を継続し、GUI backendは次段で実装する。Windowsは独立したCOM/WebView2/IME/配布受入を経て追加する。Mac Intelを初期matrixへ増やさない。

Linux/Windows実装を始める条件はmacOSの全strict gate完了ではない。shared protocolとapp/adapted profileが固定されれば着手できるが、macOSのPASSを他OSへ移植してsupportedと表示しない。人が操作できるWindows/Mac環境がない場合、その項目は未実行として残す。

## 2. Backend interface案

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

## 3. Windows: Win32 + WebView2 Evergreen

### 3.1 event loop / COM lifetime

1. UI threadのCOM apartmentを明示し、HWND/WebView controller/environmentを同じ所有規則で生成・解放する。
2. asynchronous environment/controller作成をapp/window stateへ接続し、ready前のcreate cancellation/host lossを試験する。
3. event registration tokenを台帳で管理し、destroy時に解除する。late callbackが新HWND/IDを参照しないようgenerationを確認する。
4. DPI awareness、logical boundsとphysical pixels、parent/child HWND、focusを別契約にする。
5. request/responseはnative IPCのWindows実装へ置換し、POSIX FDのinteger仕様をそのままhandleへ適用しない。

### 3.2 WebView2のbridge

WebView2のhost objectやweb message APIがElectron contextBridgeをそのまま満たすとは仮定しない。synchronous host objectの再入/JS callback制限、frame/source検証、navigation後handle失効を0007と同じstrict/adapted matrixで試験する。

1. pageから来るsource/window/frame ID文字列をauthorityとしない。
2. main frameとiframeのevent/sourceをnative APIから区別し、許可範囲をprofileへ固定する。
3. AddScript系APIの初回page script前実行、再ロード、subframe適用を実測する。
4. Windowsで一部syncが可能でもmacOS strictを昇格させない。

### 3.3 配布・managed環境

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

## 4. Linux: GTK + WebKitGTK

### 4.1 最初のplatform matrix

第一候補はUbuntu 24.04系の一つの固定imageとWayland session。具体的WebKitGTK/GTK ABI versionは利用可能なpackageと公開APIを調査してpinする。X11/XWaylandは別lane。Linuxのheadless portable testsがPASSでもGUI対応とは呼ばない。

1. GTK main loopがUI objectを所有し、QuickJS/Main同期callがこれを止めないようprivate transportを接続する。
2. user content manager/world/script messageの公開APIをversion別に確認し、native sender identityが不足する場合はそのbridge profileをblockedにする。
3. Web process sandbox、display server、D-Bus/portal、fonts、locale、IME moduleの依存を明示する。
4. clipboard/selection、native file chooser/portal、window activation、fractional scaleを実操作で比較する。
5. package availabilityを調べずsystem WebKitが全Linuxにあると仮定しない。

### 4.2 gpuiとGTKの関係

初期はstandalone GTK/WebView hostとしてcommon protocolに接続する。gpui Linux window内への埋め込みを必須にする場合、GTKとgpuiのevent loop、native surface、focus/teardownの公開契約を小fixtureで実証してから統合する。複数UI loopの安易なnested pollingで動作したことを受入にしない。

### 4.3 packaging

deb/rpm/portable等の形式は対象distro実験後に選ぶ。WebKitGTK共有libraryを外部依存にする場合、minimum ABI、導入command、cold download、security updatesの担当をmanifestへ記す。Flatpak/portal等を採る場合はfile grant/storage/URL handlerのprofile差を追加する。未検証のAppImageで全distro対応と表示しない。

## 5. Cross-platformで共通化する試験

1. MoonBit lifecycle/ID/limits/codecのpure contract。
2. native transportのframing/deadline/replay/correlationとprocess loss。
3. same fixtureによるwindow bounds/load/close/quitの必要なevent先後関係。
4. actual bridgeのframe/document spoof・navigation失効・payload境界。
5. app操作のopen/edit/save/restart、実file bytesとstorage分離。
6. OS固有IME、AX、DPI、Menu/clipboardの独立確認。

expected traceには共通制約とOS固有差を明示し、platformごとに都合のよいexpected値を無記録で増やさない。

## 6. 分割PR / 完了条件

1. shared backend capability schemaとfake contractを実装する。
2. Linux/Windowsそれぞれ最小native windowとprivate transportを追加する。
3. loader/window/lifecycle、isolated bridge、native IPCを段階接続する。
4. OS services・storage・実app・interactive・packagingを独立laneで受入する。
5. 対象OS/CPU/WebView versionとprofileだけをsupported matrixへ追加する。

各OSはA-Jのrequired subsetを自分のevidenceで満たす。compile-only、WindowsでのLinux container試験、別OSのスクリーンショットをnative互換証拠にしない。

## 7. 出典

1. [S1: WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)、[Evergreen/Fixed](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version)
2. [WebKitGTK API reference](https://webkitgtk.org/reference/) — 使用ABI/APIは実装時に固定。
3. [Issue 0001 OS設計](0001-electron-compatible-lightweight-runtime.md)、[PR #3 macOS-first](https://github.com/f4ah6o/electron.mbt/pull/3)
4. bridge公開APIの一次資料は [0007](0007-context-bridge-feasibility-and-security.md) に集約。
