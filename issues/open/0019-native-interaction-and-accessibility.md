# 0019: 日本語入力・focus・accessibility・日常操作の受入設計

Status: open
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: test/native-input-evidence-and-focus

## 概要

日本語IME、focus、keyboard/Menu、基本accessibilityを、最小fixtureとMojiの実rendererで検証する受入・計測実装 issue。P1で、日常利用previewの必須gate。利用者への影響は文字の欠落/重複、誤window入力、保存shortcut、読み上げで現在位置を失う不具合を検出すること。

**最初の着手単位は G case の観測schemaとtarget-window判定/誤配送負例。** 計測・report validator・手動手順は現在着手でき、IMEやVoiceOverの結果が未知でも調査を開始できる。実機不足は該当caseのNOT RUNとして管理する。

| 項目 | 内容 |
| --- | --- |
| 優先度 | P1 / 実用previewの必須gate |
| 依存 | [0009 host](0009-native-host-lifecycle-and-processes.md)、[0012 OS services](0012-os-services-and-desktop-integration.md)、[0014 apps](0014-real-app-acceptance.md) |
| 証跡 | [0015](0015-oracle-ci-and-evidence.md) |

## 背景

### 1. 何を証明するか

実ユーザーが同じアプリで、日本語を入力し、選択・コピー・保存し、複数windowや別appへfocusを移し、読み上げ/keyboard操作を使えることを確かめる。DOM event合成、programmatic value変更、単純な画素一致、AX roleの存在はそれぞれ限定した証拠であり、日常操作全体の代用にしない。

mainのnative probeにはresize、posted trusted key、named pasteboard、in-process AX等の部分観測がある。IME、VoiceOver、hardware入力、second-display DPI等の未実行項目は0005のsnapshotと各artifactに従って保持する。

[現 native probe](https://github.com/f4ah6o/electron.mbt/blob/8177cf051976b8d7b9eca25ae7ad8820bb04a719/platform/macos/WKNativeProbe.m)、[現 validator tests](https://github.com/f4ah6o/electron.mbt/blob/8177cf051976b8d7b9eca25ae7ad8820bb04a719/tests/macos-probe-validation.test.cjs) の確認範囲を下のtest planへ記録した。

## 問題

`isTrusted=true` のposted event、DOM model変更、AX role取得のいずれかだけでは、実IME変換・VoiceOver操作・physical keyboardを完了したことにならない。入力先のpid/titleだけを記録しても、同一processの別windowや再作成されたdocumentを区別できない。

既存probeは部分観測であり、欠測/null/timeoutを成功へ丸めると製品gateを誤って閉じる。観測level、actual target、expected/actualの本文・selection・bytesを先に定義する。

## 目標

G-IME-01〜08、G-FOCUS-01〜05、G-KEY-01〜02、G-PTR-01と基本AXを、固定app/profile/OS/input sourceの組合せで実測する。candidateが文字とselectionを保持し、解除/close/reload後の旧targetに新たな入力を配信せず、manual/automationの実行範囲を正しく報告する。

## 対象外

全OS/全IME/全screen readerの認定、pixel完全一致、OS file dropの未実装同期path取得、headless結果によるGUI受入の代用は含まない。Windows/UIAとLinux/AT-SPI、multiple-display拡張は各laneの受入として保持する。

## 提案する方針

### 最初の bounded slice と既存/予定箇所

1. 現 `platform/macos/WKNativeProbe.m`、`fixtures/worlds/gates.html`、`scripts/macos-probe.cjs`、`tests/macos-probe-validation.test.cjs` を入口にする。既存trace名とNOT RUNの項目を消さず、required observations不足の負例を追加する。
2. 新しいcase recordに `caseId, profileHash, appHash, OS/WebKit/inputSource, evidenceLevel, target, expected, observed, cleanup, verdict` を持たせる。targetはhostが所有するsession/window/document世代とnative window対応を記録し、DOM/titleの自己申告で認証しない。
3. 最初のfixtureを1編集欄・2つのowned window・synthetic test textに限定する。focusを失う/対象をdestroy-recreateする負例で入力を停止し、予約済eventの実配送先を記録する。入力前チェックだけで既にqueueにあるeventまで取り消せたとは主張しない。
4. record schema/validatorとmanual手順を先に実装し、その後native target bindingと最小fixture、最後にMojiへ同じcase IDを接続する。新しいinteractive runner/CI entryは追加予定で、今のmacOS probeを全G case実行commandへ改名しない。
5. clipboardの既知side effect修正はEP-01/0005/0012と共有する。physical/manualは本人が選択したdisposable検証環境で実行し、programmatic/native automationと別のevidenceLevelで保存する。

### 互換性・migration

既存 `wknative` reportのtrace名を保持し、追加schema/versionを明記する。過去の `inputOsEvent` を `realKeyboardHardware`、`accessibilityTree` を `voiceOverTraversal` へ読み替えない。supported environmentは実測した範囲を列挙し、旧NOT RUNへ成功defaultを補わない。

### 2. 試験環境と隔離

1. macOS Apple SiliconのOS/SDK/WebKit、入力source、keyboard layout、display scale、実行window、アプリrevisionを記録する。
2. 必要なAccessibility/Input Monitoring許可は実際の状態を確認し、未許可は未実行とする。
3. app dataはdisposable user/test root、clipboardは可能な限りprivate bufferを使う。一般clipboardとinput sourceを変更する試験は実行前状態と復元結果を記録する。
4. 入力対象をnative window identityで固定し、focusが失われたら入力を止める。タイトルの一致だけで別windowへ入力しない。
5. 別app・被覆window・背面windowへkey/clickが誤配送されない負例を用意する。
6. headless/GUIなし/remote desktop制約でできなかった操作をsynthetic eventで置き換えて合格にしない。

vlmkitを採用する場合も選択window束縛が受入済みかを別途確認する。ツール名を選んだこと自体を入力配送の安全性証明にしない。

### 8. 実装順・完了条件

1. #6のprobe判定/副作用を修正し、missing/null/stallを区別する。
2. native target-window固定とdiagnostic recordを追加する。
3. 最小fixtureでIME/focus/clipboard/AX/DPIを検証する。
4. 同じケースをMojiの実rendererで実施する。
5. reload/crash/closeと入力のrace、2window/被覆を追加する。

preview gateは必須G-IME/G-FOCUS/keyboard/基本AXとM1-M3操作の完了。multiple-displayや追加screen readerを未検証のまま出すならsupported environmentから明示的に除外し、日常操作の基本必須を未実行で通さない。

## 受け入れ条件

### 最初の slice の受入

- [ ] case record の target/evidenceLevel/expected が欠損した場合、validator は invalid evidence とし、必須 G case の PASS に数えない。
- [ ] 最初の model/validator fixture では、2 window の切替、document 失効、target 不一致を注入すると、新規入力要求を拒否し、誤配送 observation は FAIL になる。これを actual window binding の証明にしない。
- [ ] posted trusted event と physical/manual 操作を別 evidence level のまま集計し、前者だけで hardware/IME/VoiceOver を PASS にしない。
- [ ] locked oracle と candidate の比較器は、同じ case ID の最終文字列・selection・model・保存 bytes を照合し、missing/null/比較対象の hash 不一致を合格にしない。

後続 native fixture では実 owned window の focus 切替/destroy による停止と実配送先を観測する。実 app では同じ入力手順を実行し、上記比較器へ actual evidence を渡す。最初の schema PR に実機全件 PASS を要求しない。

下記の旧§3〜§6は実機/日常操作のrequired matrix。最初のschema PRはこれらの実行結果を捏造せず、実行可能なcaseから記録を埋める。

### 3. 日本語IME matrix

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

### 4. Keyboard / focus / pointer

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

### 5. Accessibility

1. runtime windowとWebViewがOS accessibility treeへ正しいrole/name/value/stateを出す。
2. Web contentのheading、button、textbox、selection、disabled状態を読み上げで確認する。
3. keyboardのみでguide、新規文書、open、編集、save、closeに到達できる。
4. dialog open/close、error表示、document更新が読み上げ/focusに反映される。
5. native MenuとWebView間を移動した後に現在位置を失わない。
6. high contrast、text zoom、reduced motion等は対象アプリとOSの必要範囲で比較する。

macOSはVoiceOver、WindowsはUIA/実screen reader、LinuxはAT-SPI/実screen readerを別laneにする。macOSのAX属性を読んだだけでVoiceOver操作PASSとはしない。

### 6. DPI・window・表示

1. logical sizeとphysical screenshot size/DPRを別に記録する。
2. 外枠/content size、title bar、work area、負座標、display移動を測る。
3. resize中にcaret/selection/scroll位置が不自然に消えないことを確認する。
4. 1台displayでDPR=1が見えたことをmulti-display適合として数えない。
5. light/dark、font fallback、日本語font、emoji、印字/line wrapを対象appで比較する。
6. pixel diffは補助とし、engine差で許容するfont antialiasを事前記録する。全pixel一致をsemantic合格の条件にしない。

## テスト計画

### コマンドと手動手順の分担

| command / 手順 | 前提・確認範囲 | 今回 |
| --- | --- | --- |
| `node --test tests/macos-probe-validation.test.cjs` | source読取済み。新record/欠測/nullのvalidator負例を追加後に実行 | NOT RUN |
| `node scripts/macos-probe.cjs --build-only` | macOS SDK。listed probesのcompileのみ | NOT RUN |
| `ELECTRON_MBT_OS_PASTE_OPT_IN=1 npm run probe:macos` | EP-01修正後のdisposable GUI/clipboard環境。posted event等の限定観測 | NOT RUN |
| G-IME-01→03 | 記録した日本語入力sourceで「あいう」入力、変換候補選択/Return確定、次のReturn改行、別試行でEscape取消。操作ごとの本文/selection/eventを保存 | NOT RUN |
| 基本AX / G-FOCUS | VoiceOverでwindow/編集欄/保存controlを移動・読み上げ、Tab/Shift-Tab、別app復帰を行い、実targetと実音声/操作結果を記録 | NOT RUN |
| Moji全required case | pinned build、native services、disposable OS user、M1〜M3。最小fixtureと同じIDで再実行 | NOT RUN |

現在の `WKNativeProbe.m` は CGEventPostToPid と NSEvent の別経路を記録し、IME/VoiceOver/hardware/second-displayをNOT RUNとして残す。`phaseOsPaste` と `phasePasteboard`、AX観測のsourceを読んだが、今回の整備では入力・clipboard・screen reader操作を行っていない。

### 7. 試験実装と証跡

各caseにはsetup、操作、expected text/model、native event、observed result、cleanupを持たせる。video/screenshotだけでなく文字列・選択位置・保存byte・window identity・event回数を保存する。

| level | 使い道 | 合格を主張できる範囲 |
| --- | --- | --- |
| DOM synthetic | model/handler単体、異常順序 | DOM契約のみ |
| programmatic native event | host接続、responder試験 | そのdelivery経路 |
| trusted OS event automation | 実target windowへ入力 | 実automation経路、permissionを記録 |
| physical/manual | IME候補・screen reader・複数display | 実際に操作したcase |

手動caseは担当、日時、環境、操作手順、expected/actual、証跡digestを付ける。自動化できないcaseを削除せず、release前に必要なmanual gateとして残す。

## リスク

focusを一度確認してからeventをpostするだけでは配送までのraceが残る。native target/check/実delivery observationを結び、既に走った入力を取り消したことにしない。driverが対象windowを安全に限定できない経路はautomationの合格対象に入れず、限定したmanual fixtureへ分ける。

IME/sourceやclipboardを変える試験は既存状態と復元結果を記録する。permission拒否、remote/headless制約、実機不在はenvironmentのNOT RUNであり、semantic成功にも実装不可能の結論にも変えない。

## 未解決の質問

| 未決事項 / blocked scope | Owner role | 必要な根拠・再開条件 |
| --- | --- | --- |
| previewのminimum macOS/SDK、入力source、keyboard/displayのrequired matrix。公開supported範囲の確定だけを保留 | platform / QA | 0021 DEC-08、実機inventoryとB3/API availability、選択した組合せのG evidence。既存環境での探索試験は開始可能 |
| automationのqueued eventをnative window/documentにどこまで束縛できるか。該当自動配送経路の安全性宣言を保留 | native interaction / security | owned window切替/被覆/reload/crash負例、実delivery先のtrace、独立review。未証明ならmanualと区別してNOT RUN/unsupported |

各caseの未知のexpected/observed差は調査対象として記録する。native/screen reader結果が未取得であることだけを、schema・手順・negative fixture作成のblockerにしない。

## 変更履歴

- 2026-10-17: polish-issue に合わせ、最初の観測schema/target-window slice、実在commandとmanual手順、driver/実機matrixの限定した未解決範囲を追加した。旧 §1〜§9、全G ID、証跡levelとNOT RUNを保持し、queued inputを取り消せるとの過大保証を避けた。 runtime/API の実装変更や互換状態の昇格は行っていない。

## 注記

### 準備状態・格納先・確認基点

record/validator/手動手順とowned-window負例の実装は着手可能。実機はcaseごとの通常の実行前提として記録する。preview supported matrixとautomation安全性の結論は上表の証拠取得後に決め、調査開始と製品認定を分ける。

`Status: open` と `issues/open` は、[AGENTS.md](../../AGENTS.md) の「runtime の受入まで issue を open に保つ」規約と、今回の指定格納先に合わせる。整備済みの初回作業は着手してよく、未知の実験結果や後続実装の未完成だけを調査開始の blocker にしない。`polished` への移動や新しい保留状態は追加しない。将来の状態変更は同規約の受入と状態遷移を確認し、元状態 `open`・復帰先 `issues/open/0019-native-interaction-and-accessibility.md` を基準に判断する。

Branch は最初の実装 PR の候補名である。今回の本文整備は main 向けで、ブランチ作成済みという意味ではない。旧番号付き節を小見出しとして保持したため、既存の § 番号と fixture ID を引き続き参照できる。

文書の取得基点は main `8177cf051976b8d7b9eca25ae7ad8820bb04a719`。2026-10-17 の runtime 調査基点 `30c6fc97186e7ecfc8397c799525f00c8e4f0f65` と既存 PR の固定 HEAD は、履歴上の根拠として維持する。本文の公式文書引用は contract の参照であり、実装済み・native PASS の代用ではない。

### 9. 出典

1. [main native probe](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/platform/macos/WKNativeProbe.m)
2. [main progress ledger](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/docs/0001-progress.md)
3. [PR #6](https://github.com/f4ah6o/electron.mbt/pull/6)、[PR #2 native host](https://github.com/f4ah6o/electron.mbt/pull/2)
