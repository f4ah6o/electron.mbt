# 0012: OS servicesと日常のデスクトップ操作の実装設計

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / 現mainではdialog/files/clipboard APIは未実装 |
| 優先度 | P1。Mojiのboot/必須操作に含まれるsymbolはP0へ繰上げ |
| 依存 | [0009 host](0009-native-host-lifecycle-and-processes.md)、[0010 IPC](0010-ipc-values-and-flow-control.md)、[0011 data](0011-app-loading-origin-and-storage.md) |
| 実アプリ | [0014](0014-real-app-acceptance.md) |

## 1. 対象の決め方

ファイルを開く・編集する・保存する・終了する一連の操作に必要なAPIと、Main評価時のimport/propertyアクセスに必要なAPIを分けて棚卸す。MojiのMenu、screen、shell、settings、updater/export依存は「画面操作しない」だけで不要と判断しない。

Electron API名を全部stubで生やさない。対応する引数variant、返値、同期/非同期、event、取消、permission、platform差をmanifestの一行にする。unsupported propertyの取得がmodule評価を止める場合、その位置もdoctorで報告する。

## 2. 共通service契約

core-owned requestは `AppPrincipal` / `WindowLease` / `DocumentLease` のscope variantを持ち、operation、認可resource、callback lifetime、size budgetを含める。MainのMenu/screenやparentなしdialogにはAppPrincipalを使い、架空のcurrent documentを付けない。window操作はWindowLease、renderer-origin操作は現在のDocumentLeaseを必須にする。native adapterはUI objectを所有し、結果をtyped completionにする。UI threadでfilesystem/networkの長いI/Oをしない。

状態は `Requested → Authorized → NativePending → Completed/Cancelled/Failed`。permission deniedと利用者cancelを別にする。window closeとnative dialog replyのraceは一度だけ終端化する。dialogを閉じたこととdisk writeの取消を混同しない。

## 3. API別設計

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

## 4. ファイルdialog

1. native open/save resultからFileGrantを作り、renderer指定pathだけで権限を発行しない。
2. parent windowが閉じたらpanelをcloseし、late resultを失効する。
3. defaultPathが存在しない、拡張子追加、既存file、read-only directory、network/removable volumeを試験する。
4. `canceled:true` は空配列/undefined等、対象Electronの返値形状を保持する。
5. save selection後に権限やfile identityが変わった場合はbrokerが再検証する。
6. dialogに表示するpath、実保存先、アプリに返したpathを照合する。
7. Mojiは `multiSelections` を要求するため、選択した全fileごとにgrantを作り、順序・一部失敗・cancel・上限を検証する。single file実装だけではM2を完了にしない。

## 5. Clipboardと既存probe指摘

PR #6に残るレビュー指摘は先行修正対象である。一般clipboardを変更するDOM `writeText` がopt-in外、欠損観測を `as-expected` として受理、NSNullをdictionaryとして扱う危険が指摘されている。[0005](0005-existing-work-and-integration.md)で現mainへの照合結果を記録する。

1. 単体試験はnamed/private pasteboardを用いる。
2. 実OSコピー/貼り付けは明示した検証環境とopt-inで実行し、保存・復元可能な範囲と不可なformatを記録する。
3. text以外の既存clipboard dataを無言で破壊してから「復元した」と表示しない。
4. native pasteboard API成功、DOM clipboard API成功、実keyboard paste、アプリ本文への挿入は別の観測とする。
5. permission拒否・user activation不在・stall・missing/null resultを失敗/未実行として扱い、成功placeholderを生成しない。
6. synchronous `clipboard.readText` はnative brokerのbounded callで保持する。pageへ汎用clipboard権限を公開しない。

## 6. Menu・keyboard・window integration

Menu modelとID/lifetimeはMoonBitが所有する。native itemはmodel revisionを保持し、古いclick callbackが新itemへ誤配送されないようにする。JS click callbackはMain realmに残す。

1. macOSのapp menu、Editのcopy/paste/selectAll/undo、Window項目を対象アプリの必要範囲で実装する。
2. accelerator文字列のparse、OS修飾キー、repeat、IMЕ確定キーとの競合を検証する。
3. enabled/visible/checked変更の反映とdestroy後のclick拒否を確認する。
4. role動作を単なるJS key event合成で置き換えない。実WebView responder chainに接続する。
5. submenu/modal/context menuは別variantにし、未対応をsilent ignoreしない。

Tray、通知、global shortcutはM3以降の需要順とするが、Mojiの起動閉包で要求される場合はstub選択ではなくscope見直しgateへ戻す。

## 7. 外部URL・ネットワーク・protocol

`shell.openExternal` はuser gestureやMainアプリpolicyの必要性をprofileで定義する。`https`等の明示allowlistに限定し、`file`、custom executable scheme、credential付きURLを既定許可しない。引き渡すURLは標準parserでscheme/host等を検査し、文字列prefixだけで許可しない。外部browserへ引き渡した後のredirect先はruntimeが観測・強制できるとは仮定しない。最終遷移先まで制限する機能は、別のmanaged WebView/network profileと受入を要する。

OSがURLを受理したACKは、外部サイトのロード完了を保証しない。二重click・取消・host lossで勝手に再openしない。

jmdの `protocol.registerSchemesAsPrivileged` にある `bypassCSP:true` は起動時gateとして記録し、属性を落として成功を返さない。secure custom protocolはM4拡張で、origin、CSP、path authorization、MIME、range、cache、downloadをまとめて設計する。

`net`/fetchが必要な場合はproxy、TLS trust、証明書error、timeout、abort、redirect、offlineを別受入にする。証明書検証の無効化で接続成功を作らない。

## 8. 試験と完了

| What | 必要証跡 |
| --- | --- |
| open/save/cancel | actual dialog、admission前cancelは副作用なし、accepted Main処理とrename後取消はcommitted/unknownを区別してbytes照合 |
| clipboard | named testと実pasteの別trace、元内容影響の記録 |
| Menu/accelerator | 実keyboard/responder chain、callback回数、IME非破壊 |
| open-file/activate | 起動前後・二重open・複数windowで正しい対象 |
| shell | 許可/拒否scheme、native failure、重複配送なし |
| lifetime | dialog中close、旧Menu callback、session停止後reply |

実装単位はdialog → file連携 → Menu/roles → clipboard → desktop lifecycle →必要な追加service。各PRにfake-host負例とnative positive/negativeを含め、fakeのみでAPIをverifiedにしない。

完了は0014の必須シナリオに必要な全serviceの受入と、未対応variantのtyped diagnosticが揃うこと。全Electron OS API互換の完成を意味しない。

## 9. 出典

1. [PR #6 probeレビュー](https://github.com/f4ah6o/electron.mbt/pull/6#issuecomment-6136804622)
2. [Electron dialog](https://www.electronjs.org/docs/latest/api/dialog)、[clipboard](https://www.electronjs.org/docs/latest/api/clipboard)、[Menu](https://www.electronjs.org/docs/latest/api/menu)、[shell](https://www.electronjs.org/docs/latest/api/shell)
3. [PR #3の実アプリtarget](https://github.com/f4ah6o/electron.mbt/pull/3)、[jmd固定main](https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/electron/main.js)
