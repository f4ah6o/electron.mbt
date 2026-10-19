# 0012: OS servicesと日常のデスクトップ操作の実装設計

Status: polished
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: feat/os-service-request-lifecycle

## 概要

Moji の open/save/Menu/clipboard と desktop lifecycle を実 OS services へ接続する実装 issue。P1、boot/必須操作の未実装symbolはP0。利用者には、native dialog の選択/cancel、日常shortcut、正しいwindowへのcallback、異常時の明示失敗として現れる。

**最初の着手単位は service request の scope/terminal contract と、非同期 open dialog の overload 検証。** fake-host と MoonBit の contract は今着手できる。native panel/file grantの完成はEP-14/16/17と接続して判断する。

| 項目 | 内容 |
| --- | --- |
| 優先度 | P1。Mojiのboot/必須操作に含まれるsymbolはP0へ繰上げ |
| 依存 | [0009 host](0009-native-host-lifecycle-and-processes.md)、[0010 IPC](0010-ipc-values-and-flow-control.md)、[0011 data](0011-app-loading-origin-and-storage.md) |
| 実アプリ | [0014](0014-real-app-acceptance.md) |

## 背景

### 1. 対象の決め方

ファイルを開く・編集する・保存する・終了する一連の操作に必要なAPIと、Main評価時のimport/propertyアクセスに必要なAPIを分けて棚卸す。MojiのMenu、screen、shell、settings、updater/export依存は「画面操作しない」だけで不要と判断しない。

Electron API名を全部stubで生やさない。対応する引数variant、返値、同期/非同期、event、取消、permission、platform差をmanifestの一行にする。unsupported propertyの取得がmodule評価を止める場合、その位置もdoctorで報告する。

[現 facade](https://github.com/f4ah6o/electron.mbt/blob/8177cf051976b8d7b9eca25ae7ad8820bb04a719/bridges/node/electron-facade.cjs) と [現 native probe](https://github.com/f4ah6o/electron.mbt/blob/8177cf051976b8d7b9eca25ae7ad8820bb04a719/platform/macos/WKNativeProbe.m) の sourceを確認した。probeの存在をdialog/Menu製品APIの存在として扱わない。

## 問題

Mainのparentless dialogやMenuに架空のdocumentを付けると、未改修Electron APIと権限設計が衝突する。反対にrenderer由来のoperationをMain同等の無制限権限で直接受けることもできない。

cancel、permission denied、native failure、commit後の通信断を同じ成功/取消へ丸めると、保存やcloseの結果を誤報告する。DOM/clipboard probeの部分観測は実Menu/responder/paste/VoiceOver操作とは別の証拠である。

## 目標

request の実principal/window/document scopeをcoreが検証し、許可したnativeサービスだけを実行する。open/saveの返値shape、multiSelections、cancel、Menu click identityとrole、同期clipboardのbounded returnを個別に受入し、Mojiの日常操作に必要なvariantを先行する。

## 対象外

全Electron OS API、同期modal dialog、全Tray/notification/global shortcut、汎用page clipboard権限、外部browser内のredirect強制、jmdのprivileged protocolの黙った弱化を初回sliceに含めない。対象外でもboot importに必要ならdoctorで明示し、空stubへ置換しない。

## 提案する方針

### 最初の bounded slice と変更箇所

1. `core/` / 新規予定 `host_services/` に `ServiceRequest {id, scope, operation, resource, budget}` と `Pending/Terminal` 台帳を追加する。scopeは `AppPrincipal / WindowLease / DocumentLease` のvariant、terminalは `Completed / Cancelled / Failed`。取消/late replyを同じidへ二重適用しない。
2. 最初のoperationを `showOpenDialog(options)` と `showOpenDialog(parent, options)` に絞る。`properties: ['openFile','multiSelections']`、filters、defaultPathをmanifestで許可/拒否し、結果は `{canceled, filePaths}`。cancel時のarray/undefined等の細部は固定Electron fixtureと比較する。
3. 既存 `bridges/node/electron-facade.cjs` はdialog/shell等をunsupportedにする。public facadeの追加はscope/shape検証と同じPRへ置き、実native未接続variantは明示拒否を維持する。native panelは `platform/macos/`、model/policyはMoonBit、JS callbackはMain realmのleafが所有する。
4. 第1PRはfake-hostでscope/overload/取消/late resultを検証する。native panelはEP-17のUI lifecycle、file権限はEP-16のbroker、renderer由来呼出しはEP-14のingressに接続する別PRとする。
5. PR #6のclipboard opt-in/欠測/NSNull修正はEP-01/0005が所有する。ここで同じ修正を別実装にせず、その回帰をnative servicesの前提として再利用する。

### scopeと互換性の移行

`DocumentLease` は renderer→native ingress で検証する。受理された Main handler が元 API の形で新たにdialog/fsを呼ぶとき、直前のrendererを推定してleaseを後付けしない。親なしMain dialogはAppPrincipal、明示parent付きはWindowLease。document-bound serviceを直接提供する場合だけ、その明示request契約にDocumentLeaseを持たせる。

各API/overload/返値/permission差をprofileとmanifestへ追加する。既存unsupportedを偽successへ変えず、strict signatureのPromise化もしない。Main app principalの処理結果と元rendererへのreply寿命は独立で、doc revokeだけでMainのOS side effectが取り消されたとは扱わない。

### 2. 共通service契約

core-owned requestは `AppPrincipal` / `WindowLease` / `DocumentLease` のscope variantを持ち、operation、認可resource、callback lifetime、size budgetを含める。MainのMenu/screenやparentなしdialogにはAppPrincipalを使い、架空のcurrent documentを付けない。window操作はWindowLease、renderer-origin操作は現在のDocumentLeaseを必須にする。native adapterはUI objectを所有し、結果をtyped completionにする。UI threadでfilesystem/networkの長いI/Oをしない。

状態は `Requested → Authorized → NativePending → Completed/Cancelled/Failed`。permission deniedと利用者cancelを別にする。window closeとnative dialog replyのraceは一度だけ終端化する。dialogを閉じたこととdisk writeの取消を混同しない。

### 3. API別設計

| 領域 | 最初の実装 | 契約・限界 |
| --- | --- | --- |
| open dialog | `dialog.showOpenDialog` | Promise、canceled/filePaths、parent window、filter、single file＋Moji必須のmultiSelections |
| save dialog | `dialog.showSaveDialog` | Promise、canceled/filePath、overwrite確認、extension/defaultPath |
| message dialog | `showMessageBox` | button index、cancel/default、parent、shutdown中の取消 |
| clipboard | `readText/writeText` | Unicode、所有権、他アプリdata非破壊の試験 |
| shell | `openExternal` | 許可scheme/host、native拒否、Promise outcome |
| Menu/MenuItem | buildFromTemplate/setApplicationMenu | role、accelerator、enabled/checked、click identity |
| screen | getPrimaryDisplay、getAllDisplays、workArea | logical pixel、DPI、負座標、display-change |
| app lifecycle | activate/open-file/single instance | 起動前後event、multiple open、正しいfocus先 |
| persisted settings | fs/pathを通す既存Main | save atomicity、data root、再起動readback |
| Tray/Notification/shortcut | 実アプリ需要で追加 | lifetime、permission、OS event、登録解除 |

同期dialog APIを必要としないアプリから着手する。同期APIを追加する場合、native modal loopとMain reentryが相互待ちしないことを実証し、Promise版の使い回しで署名を変えない。

### 4. ファイルdialog

1. native open/save resultからFileGrantを作り、renderer指定pathだけで権限を発行しない。
2. parent windowが閉じたらpanelをcloseし、late resultを失効する。
3. defaultPathが存在しない、拡張子追加、既存file、read-only directory、network/removable volumeを試験する。
4. `canceled:true` は空配列/undefined等、対象Electronの返値形状を保持する。
5. save selection後に権限やfile identityが変わった場合はbrokerが再検証する。
6. dialogに表示するpath、実保存先、アプリに返したpathを照合する。
7. Mojiは `multiSelections` を要求するため、選択した全fileごとにgrantを作り、順序・一部失敗・cancel・上限を検証する。single file実装だけではM2を完了にしない。

### 5. Clipboardと既存probe指摘

PR #6に残るレビュー指摘は先行修正対象である。一般clipboardを変更するDOM `writeText` がopt-in外、欠損観測を `as-expected` として受理、NSNullをdictionaryとして扱う危険が指摘されている。[0005](0005-existing-work-and-integration.md)で現mainへの照合結果を記録する。

1. 単体試験はnamed/private pasteboardを用いる。
2. 実OSコピー/貼り付けは明示した検証環境とopt-inで実行し、保存・復元可能な範囲と不可なformatを記録する。
3. text以外の既存clipboard dataを無言で破壊してから「復元した」と表示しない。
4. native pasteboard API成功、DOM clipboard API成功、実keyboard paste、アプリ本文への挿入は別の観測とする。
5. permission拒否・user activation不在・stall・missing/null resultを失敗/未実行として扱い、成功placeholderを生成しない。
6. synchronous `clipboard.readText` はnative brokerのbounded callで保持する。pageへ汎用clipboard権限を公開しない。

### 6. Menu・keyboard・window integration

Menu modelとID/lifetimeはMoonBitが所有する。native itemはmodel revisionを保持し、古いclick callbackが新itemへ誤配送されないようにする。JS click callbackはMain realmに残す。

1. macOSのapp menu、Editのcopy/paste/selectAll/undo、Window項目を対象アプリの必要範囲で実装する。
2. accelerator文字列のparse、OS修飾キー、repeat、IMЕ確定キーとの競合を検証する。
3. enabled/visible/checked変更の反映とdestroy後のclick拒否を確認する。
4. role動作を単なるJS key event合成で置き換えない。実WebView responder chainに接続する。
5. submenu/modal/context menuは別variantにし、未対応をsilent ignoreしない。

Tray、通知、global shortcutはM3以降の需要順とするが、Mojiの起動閉包で要求される場合はstub選択ではなくscope見直しgateへ戻す。

### 7. 外部URL・ネットワーク・protocol

`shell.openExternal` はuser gestureやMainアプリpolicyの必要性をprofileで定義する。`https`等の明示allowlistに限定し、`file`、custom executable scheme、credential付きURLを既定許可しない。引き渡すURLは標準parserでscheme/host等を検査し、文字列prefixだけで許可しない。外部browserへ引き渡した後のredirect先はruntimeが観測・強制できるとは仮定しない。最終遷移先まで制限する機能は、別のmanaged WebView/network profileと受入を要する。

OSがURLを受理したACKは、外部サイトのロード完了を保証しない。二重click・取消・host lossで勝手に再openしない。

jmdの `protocol.registerSchemesAsPrivileged` にある `bypassCSP:true` は起動時gateとして記録し、属性を落として成功を返さない。secure custom protocolはM4拡張で、origin、CSP、path authorization、MIME、range、cache、downloadをまとめて設計する。

`net`/fetchが必要な場合はproxy、TLS trust、証明書error、timeout、abort、redirect、offlineを別受入にする。証明書検証の無効化で接続成功を作らない。

## 受け入れ条件

### 最初の slice の受入

- [ ] parent なし Main dialog の受付は `AppPrincipal` を使い、current document を要求・捏造しない。
- [ ] parent 付き dialog で window 破棄と reply を両順序で注入すると、1 回だけ終端化し、旧 panel の結果で新 window へ grant しない。
- [ ] renderer-origin request の grant/operation 不一致を注入すると、panel/clipboard/URL open の fake effect count は 0 になる。
- [ ] `multiSelections` の複数 regular file を fake native result として返すと、全 file の grant 要求・順序・上限を検証し、source/read-only guide への write 昇格を拒否する。実 picker/FileGrant の発行は後続の native 統合試験で行う。
- [ ] failure や unknown variant に対して、公開 API は typed failure/unsupported を返し、空の成功 result を返さない。

fake-hostの合格は最初のcontractの出口。whole-issueは以下のactual native evidenceを満たす。

### 8. 試験と完了

| What | 必要証跡 |
| --- | --- |
| open/save/cancel | actual dialog、admission前cancelは副作用なし、accepted Main処理とrename後取消はcommitted/unknownを区別してbytes照合 |
| clipboard | named testと実pasteの別trace、元内容影響の記録 |
| Menu/accelerator | 実keyboard/responder chain、callback回数、IME非破壊 |
| open-file/activate | 起動前後・二重open・複数windowで正しい対象 |
| shell | 許可/拒否scheme、native failure、重複配送なし |
| lifetime | dialog中close、旧Menu callback、session停止後reply |

実装単位はdialog → file連携 → Menu/roles → clipboard → desktop lifecycle →必要な追加service。先行する contract PR は fake-host の正負例で完了できる。native service へ接続する各 PR では fake-host 負例に加えて actual native positive/negative を要求し、fake のみで API を verified にしない。

完了は0014の必須シナリオに必要な全serviceの受入と、未対応variantのtyped diagnosticが揃うこと。全Electron OS API互換の完成を意味しない。

## テスト計画

| command / 手順 | 前提・確認範囲 | 今回 |
| --- | --- | --- |
| `moon test --target js`、`moon test --target native` | 新service scope/terminal/fake-host contract | NOT RUN |
| `npm run build` 後に `node --test tests/facade.test.cjs tests/transport.test.cjs` | 現 facade のunsupported/返値とprivate bounded RPC回帰 | NOT RUN |
| `node --test tests/macos-probe-validation.test.cjs` | EP-01の欠測・null・opt-in負例を追加した版を使用 | NOT RUN |
| `node scripts/macos-probe.cjs --build-only` | macOS SDK。既存probeのcompileのみ | NOT RUN |
| `ELECTRON_MBT_OS_PASTE_OPT_IN=1 npm run probe:macos` | EP-01修正後、一般clipboard/inputがdisposableな明示検証環境のみ。probeのlisted observations | NOT RUN |
| actual panel/Menu/file integration | 新native service runnerを実装PRで追加。M2/M3、Cmd+S/C/V/Z、cancel/crashとbytes照合 | NOT RUN |

`WKNativeProbe.m` の `phaseOsPaste / phasePasteboard` と `tests/macos-probe-validation.test.cjs` を読み直した。DOM writeText/execCommandがopt-in外に残る経路は、現コードを無害なopt-out試験として実行できない理由である。今回はGUI/clipboardを操作していない。

## リスク

UI threadでMain callback待ちや長いI/Oを保持すると停止性が崩れる。同期dialogは別のreentrancy gateに残し、非同期panelの返答と閉鎖を一つのterminal台帳へ結ぶ。

一般clipboardの復元はformatによって完全ではないため、named/private試験と実OS pasteを区別する。native URL handoff ACKを外部サイトの成功へ昇格しない。parentless AppPrincipal serviceを無関係なrenderer navigationで取り消すなど、scopeを跨ぐlifetime変更を加えない。

## 変更履歴

- 2026-10-17: ユーザー指示により `issues/open` から `issues/polished` へ移動し、`Status: polished` と現行参照を同期。実装の準備状態・未解決事項・受入証拠は変更していない。

- 2026-10-17: polish-issue に沿ってservice scope/terminalと非同期open dialogの最初のslice、native依存、既存facade/probe testsとcommands、Mainからの再呼出しにdocumentを後付けしない条件を追加した。旧 §1〜§9 とclipboard/外部URL/保存commit境界を保持した。 runtime/API の実装変更や互換状態の昇格は行っていない。

- 2026-10-20: Node-less adapted profile に Main `dialog.showOpenDialog` の限定sliceを実装。real `NSOpenPanel`（app-modal）と test-injected selection で read grant を発行し、prelude は bounded options と unsupported dialog API を fail-closed にする。human selection、write consent、sheet-modal parent、save dialog、grant persistence/revocation は未実装で、compatibility は昇格していない。docs/0050。

## 注記

- 2026-10-17: ユーザー指示「mv to issues/polished」に従い、整備済みの計画を open から polished へ移動。未解決事項・依存条件・runtime の未受入は本文に保持する。

### 準備状態・格納先・確認基点

最初のservice contract/fake-host/overload実装は着手可能で、現時点でそのscopeを左右する未回答質問はない。native実装・EP-14/16/17統合・実機受入は通常の後続作業として残る。未実装という事実だけを設計blockerへ言い換えない。同期modalや追加serviceは対象外の別gateで判断する。

**状態と配置:** 2026-10-17 のユーザー指示により `open` から `polished` へ移動した。現在の保存先は `issues/polished/0012-os-services-and-desktop-integration.md`。`polished` は計画の整備状態であり、runtime の受入や未解決事項の解消を示さない。着手は本文の準備状態・依存条件に従い、受入は [AGENTS.md](../../AGENTS.md) と各試験の実証で判断する。進捗と再開条件は本ファイルへ記録する。

Branch は最初の実装 PR の候補名である。今回の本文整備は main 向けで、ブランチ作成済みという意味ではない。旧番号付き節を小見出しとして保持したため、既存の § 番号と fixture ID を引き続き参照できる。

文書の取得基点は main `8177cf051976b8d7b9eca25ae7ad8820bb04a719`。2026-10-17 の runtime 調査基点 `30c6fc97186e7ecfc8397c799525f00c8e4f0f65` と既存 PR の固定 HEAD は、履歴上の根拠として維持する。本文の公式文書引用は contract の参照であり、実装済み・native PASS の代用ではない。

### 9. 出典

1. [PR #6 probeレビュー](https://github.com/f4ah6o/electron.mbt/pull/6#issuecomment-6136804622)
2. [Electron dialog](https://www.electronjs.org/docs/latest/api/dialog)、[clipboard](https://www.electronjs.org/docs/latest/api/clipboard)、[Menu](https://www.electronjs.org/docs/latest/api/menu)、[shell](https://www.electronjs.org/docs/latest/api/shell)
3. [PR #3の実アプリtarget](https://github.com/f4ah6o/electron.mbt/pull/3)、[jmd固定main](https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/electron/main.js)
