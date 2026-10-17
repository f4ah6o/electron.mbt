# 0019: 日本語入力・focus・accessibility・日常操作の受入設計

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / probe部分観測はあるが日常利用の実機受入は未完 |
| 優先度 | P1 / 実用previewの必須gate |
| 依存 | [0009 host](0009-native-host-lifecycle-and-processes.md)、[0012 OS services](0012-os-services-and-desktop-integration.md)、[0014 apps](0014-real-app-acceptance.md) |
| 証跡 | [0015](0015-oracle-ci-and-evidence.md) |

## 1. 何を証明するか

実ユーザーが同じアプリで、日本語を入力し、選択・コピー・保存し、複数windowや別appへfocusを移し、読み上げ/keyboard操作を使えることを確かめる。DOM event合成、programmatic value変更、単純な画素一致、AX roleの存在はそれぞれ限定した証拠であり、日常操作全体の代用にしない。

mainのnative probeにはresize、posted trusted key、named pasteboard、in-process AX等の部分観測がある。IME、VoiceOver、hardware入力、second-display DPI等の未実行項目は0005のsnapshotと各artifactに従って保持する。

## 2. 試験環境と隔離

1. macOS Apple SiliconのOS/SDK/WebKit、入力source、keyboard layout、display scale、実行window、アプリrevisionを記録する。
2. 必要なAccessibility/Input Monitoring許可は実際の状態を確認し、未許可は未実行とする。
3. app dataはdisposable user/test root、clipboardは可能な限りprivate bufferを使う。一般clipboardとinput sourceを変更する試験は実行前状態と復元結果を記録する。
4. 入力対象をnative window identityで固定し、focusが失われたら入力を止める。タイトルの一致だけで別windowへ入力しない。
5. 別app・被覆window・背面windowへkey/clickが誤配送されない負例を用意する。
6. headless/GUIなし/remote desktop制約でできなかった操作をsynthetic eventで置き換えて合格にしない。

vlmkitを採用する場合も選択window束縛が受入済みかを別途確認する。ツール名を選んだこと自体を入力配送の安全性証明にしない。

## 3. 日本語IME matrix

| ID | What | 観測 |
| --- | --- | --- |
| G-IME-01 | ひらがな入力→変換→候補選択→Return確定 | 最終文字列、重複0、composition順序 |
| G-IME-02 | 変換中Escape取消 | 既存本文/selection保持、不要なcommitなし |
| G-IME-03 | 確定Returnと改行Returnの区別 | 二重改行・欠落なし |
| G-IME-04 | 日本語/ASCII/emoji/結合文字の混在 | code pointとfile bytes、caret/selection |
| G-IME-05 | composition中focus移動・dialog・window close | commit/cancelがoracleの許容契約どおり |
| G-IME-06 | composition中reload/crash | old documentへlate入力なし |
| G-IME-07 | undo/redo、Backspace、delete/selection置換 | user-visible文字と内部modelが一致 |
| G-IME-08 | inline candidateとcaret位置 | scroll/zoom/DPI変更後の候補位置 |

compositionstart/update/end、beforeinput/input、keydown/upと `isTrusted` を記録する。ただしイベントが見えただけで本文更新を合格にしない。DOM text/model/file readbackも照合する。入力sourceは開始前のものへ復元し、復元に失敗したらその状態を報告する。

## 4. Keyboard / focus / pointer

| ID | What | 受入 |
| --- | --- | --- |
| G-FOCUS-01 | 初回表示・activateで編集先へfocus | phantom focusや二重window入力なし |
| G-FOCUS-02 | Tab/Shift-Tabで循環 | trap、消失、誤native focusなし |
| G-FOCUS-03 | 別appへの切替と復帰 | 入力が対象appにのみ届く |
| G-FOCUS-04 | dialog中の親window | modal policyと復帰focusが正しい |
| G-FOCUS-05 | 2window・背面・被覆 | explicit target以外へ配信しない |
| G-KEY-01 | copy/paste/selectAll/undo/redo | WebView responderとMenu roleが一致 |
| G-KEY-02 | key repeatとshortcut | 二重処理せずIMEを破壊しない |
| G-PTR-01 | scroll/selection/drag | zoom/DPI/resize後もhit targetが一致 |

未対応drag-and-drop `webUtils.getPathForFile` を使うMoji機能は0014の除外に残す。通常テキスト選択dragとOS file dropを混同しない。

## 5. Accessibility

1. runtime windowとWebViewがOS accessibility treeへ正しいrole/name/value/stateを出す。
2. Web contentのheading、button、textbox、selection、disabled状態を読み上げで確認する。
3. keyboardのみでguide、新規文書、open、編集、save、closeに到達できる。
4. dialog open/close、error表示、document更新が読み上げ/focusに反映される。
5. native MenuとWebView間を移動した後に現在位置を失わない。
6. high contrast、text zoom、reduced motion等は対象アプリとOSの必要範囲で比較する。

macOSはVoiceOver、WindowsはUIA/実screen reader、LinuxはAT-SPI/実screen readerを別laneにする。macOSのAX属性を読んだだけでVoiceOver操作PASSとはしない。

## 6. DPI・window・表示

1. logical sizeとphysical screenshot size/DPRを別に記録する。
2. 外枠/content size、title bar、work area、負座標、display移動を測る。
3. resize中にcaret/selection/scroll位置が不自然に消えないことを確認する。
4. 1台displayでDPR=1が見えたことをmulti-display適合として数えない。
5. light/dark、font fallback、日本語font、emoji、印字/line wrapを対象appで比較する。
6. pixel diffは補助とし、engine差で許容するfont antialiasを事前記録する。全pixel一致をsemantic合格の条件にしない。

## 7. 試験実装と証跡

各caseにはsetup、操作、expected text/model、native event、observed result、cleanupを持たせる。video/screenshotだけでなく文字列・選択位置・保存byte・window identity・event回数を保存する。

| level | 使い道 | 合格を主張できる範囲 |
| --- | --- | --- |
| DOM synthetic | model/handler単体、異常順序 | DOM契約のみ |
| programmatic native event | host接続、responder試験 | そのdelivery経路 |
| trusted OS event automation | 実target windowへ入力 | 実automation経路、permissionを記録 |
| physical/manual | IME候補・screen reader・複数display | 実際に操作したcase |

手動caseは担当、日時、環境、操作手順、expected/actual、証跡digestを付ける。自動化できないcaseを削除せず、release前に必要なmanual gateとして残す。

## 8. 実装順・完了条件

1. #6のprobe判定/副作用を修正し、missing/null/stallを区別する。
2. native target-window固定とdiagnostic recordを追加する。
3. 最小fixtureでIME/focus/clipboard/AX/DPIを検証する。
4. 同じケースをMojiの実rendererで実施する。
5. reload/crash/closeと入力のrace、2window/被覆を追加する。

preview gateは必須G-IME/G-FOCUS/keyboard/基本AXとM1-M3操作の完了。multiple-displayや追加screen readerを未検証のまま出すならsupported environmentから明示的に除外し、日常操作の基本必須を未実行で通さない。

## 9. 出典

1. [main native probe](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/platform/macos/WKNativeProbe.m)
2. [main progress ledger](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/docs/0001-progress.md)
3. [PR #6](https://github.com/f4ah6o/electron.mbt/pull/6)、[PR #2 native host](https://github.com/f4ah6o/electron.mbt/pull/2)
