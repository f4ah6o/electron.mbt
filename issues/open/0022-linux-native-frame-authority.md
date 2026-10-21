# 0022: Linux native frame/sender authority の決定と負例

Status: open
Priority: P1 (security / profile scope)
Created: 2026-10-21
Updated: 2026-10-21
Branch: 未作成（提案: `feat/linux-frame-authority`）
Depends-on: [0018 Windows/Linux backend](../polished/0018-windows-linux-and-backend-contract.md) の Linux backend 契約、[0007 contextBridge](../polished/0007-context-bridge-feasibility-and-security.md)、[0015 evidence](../polished/0015-oracle-ci-and-evidence.md)
Related: [docs/0057](../../docs/0057-linux-native-host.md)、`platform/linux/NativeHost.c`、[PR #15](https://github.com/f4ah6o/electron.mbt/pull/15)

## 概要

Linux GTK/WebKitGTK host は、plain/adapted Node-less fixture の 5 テストを Linux で通した。
ただし WebKitGTK の UI-process API には macOS の
`WKScriptMessage.frameInfo.isMainFrame` に相当する sender frame 情報がない。
現在は **top-frame-only の document-start script** と **per-document nonce**、
host が stamp する window/generation で緩和しているが、これは native の
main-frame authority ではない。本 issue は、公開 WebKitGTK API で actual
frame/document を検証できるかを決め、できない場合は profile restriction と
negative test を明示して fail closed にする。

## 背景

`docs/0057` の Linux slice は次を実装・確認済み:

- `platform/linux/NativeHost.c` が fd 3/4/5 の同じ protocol で plain/adapted window、staged snapshot、`electron-mbt-app://app/...`、generated adapter、app-request/reply、document generation、stale ingress を処理する。
- `tests/nodeless-runtime.test.cjs` の 5 テスト（plain load/title、plain reload、adapted module/page API、adapted reload、stale ingress）が Linux で PASS。
- canonical frame の負例は `tests/linux-host-frame.test.cjs` で PASS。
- `compatible:false`、strict BLOCKED、元 preload NOT_EXECUTED を維持。

未証明の点:

- `webkit_user_content_manager_register_script_message_handler_with_reply` の
  `script-message-with-reply-received` は `JSCValue` と
  `WebKitScriptMessageReply` を渡すが、macOS の
  `WKScriptMessage.frameInfo.isMainFrame` / `webView` / document identity に
  相当する情報を公開していない。
- page shim は top-frame-only で、adapter は `window.__electronMbtIngress` を
  取得後に削除する。message には per-document nonce を付け、host が照合する。
  しかし nonce は page 由来の値であり、native が actual frame を照合した
  証明ではない。subframe が nonce を推測できなければ拒否される、という
  確率論的緩和に留まる。
- child frame / iframe / srcdoc からの直接 handler 呼び出し、malformed
  page message、frame-origin の negative proof は Linux では NOT RUN。
  macOS の `a malformed or frame-originated page message ...` テストは
  macOS-only のまま。
- `get-ingress-status` の admitted/denied は host が数えるが、sender の
  actual frame を根拠にした分類ではない。

## 問題

1. **authority の欠落**: page が送る `operation`/`payload`/nonce は page の
   制御下にあり、native は actual document/frame/URL を照合していない。
   top-frame-only script と nonce は緩和であり、Electron の sender 認可の
   代替証明にならない。
2. **profile の不明確さ**: Linux host が「main-frame-only」なのか、
   「subframe も同一 origin なら許す」のか、profile 契約が明文化されていない。
   child-frame parity を主张しない、という docs 記述だけでは実装の拒否条件が
   固定されない。
3. **負例の不足**: Linux で subframe / malformed message / unknown frame を
   拒否する test がない。macOS の test を Linux の PASS に転記できない。
4. **API 調査の不足**: WebKitGTK の UI API に frame 情報がないとしても、
   web extension / `WebKitWebPage` / `WebKitFrame` / `decide-policy` /
   navigation action の範囲で、public API のみを使った actual main-frame
   識別が可能かを確認していない。private selector や sandbox 無効化は不可。

## 目的

1. WebKitGTK 4.1（対象は 2.52.6、CI の Ubuntu 24.04 package）の **公開 API
   のみ**で、message の actual main frame / document / URL を取得できるか
   を inventory し、Go/No-Go を記録する。
2. No-Go の場合、Linux backend の profile restriction を明文化する:
   - supported: top-frame の adapted fixture のみ。
   - unsupported/denied: subframe/srcdoc/child からの native handler 呼び出し、
     page が frame/sender/window/generation を自己申告する message、
     unknown/stale generation。
   - page nonce は defense-in-depth であり、native frame authority の代用では
     ないと明記する。
3. Go の場合、actual frame 検証を host に実装し、subframe/iframe の負例と
   main-frame の正例を同じ fixture で記録する。macOS の frameInfo と
   同じ意味の contract にし、Linux の PASS を macOS の代替にしない。
4. どちらの場合も、`compatible:false` / strict BLOCKED / 元 preload
   NOT_EXECUTED を維持し、A〜J / readiness を昇格しない。

## 対象外

- 元 preload、`contextBridge`、`ipcRenderer`、strict profile の実装。
- private WebKit selector、sandbox/isolation の無効化、CEF/Electron の同梱。
- Linux の file/dialog/export/main fs、IME/AX、close/quit、packaging。
- macOS host の挙動変更。macOS は参照実装として同じ fixture を実行する。
- `nonce` を secret として安全と主張すること。nonce は frame authority の
  代替ではない。

## 調査項目

1. `WebKitUserContentManager` の
   `script-message-with-reply-received` / `script-message-received` の
   callback が frame を取得できるか（公開 API の header / GIR / docs）。
2. UI-process の `WebKitWebView` / `WebKitFrame` / `WebKitWebPage` の公開範囲。
   `webkit_frame_is_main_frame` / `webkit_frame_get_id` /
   `webkit_frame_get_uri` が UI process から使えるか、web extension 経由のみか。
3. `WebKitWebView::decide-policy` / `WebKitNavigationAction` で
   subframe navigation を識別・拒否できるか。`WebKitResponsePolicyDecision`
   の `is_main_frame_main_resource` の適用範囲。
4. web extension（`webkit2/webkit-web-extension.h`）で frame ID/URI を取得し、
   UI process へ relay する方式が public API のみで成立するか。成立する場合の
   lifetime / ordering / hostile page の制約。
5. `JSCValue` の context と main frame の `JSCContext` を比較する方法が
   公開 API で成立するか。成立しない場合は、その理由を記録する。
6. 現行の top-frame-only script + nonce が、subframe/srcdoc/iframe の
   どの経路を実際に拒否できるか。fixture で positive/negative を作る。

## 実装候補

### 案 A: public API で frame を取得できる場合

- host の page message handler で actual main frame を照合し、subframe は
  typed failure で拒否する。
- `inject-app-request` に frame 情報を追加するのではなく、actual message
  経路の test を追加する。
- macOS の `frameInfo.isMainFrame` と同じ意味の fixture を Linux でも実行し、
  `tests/nodeless-runtime.test.cjs` の macOS-only test を共有化する。
- 変更は `platform/linux/NativeHost.c`、frame fixture、docs/0057、CI。

### 案 B: public API で frame を取得できない場合

- Linux backend の profile restriction を `docs/0057` と
  `compatibility/manifest.json` の `linuxNativeHost.limits` に固定する。
- page message の受理条件を「top-frame-only script + nonce + host stamp」に
  限定し、subframe/unknown document は **必ず deny** する test を追加する。
- `get-ingress-status` に `frameAuthority:"unproven"` を additive に記録し、
  `admitted` を sender 認可の証明として表示しない。
- Electron child-frame parity を unsupported と明示し、A〜J を昇格しない。

## 受入基準

1. WebKitGTK 2.52.6 の公開 header / GIR / 公式 docs に基づく API inventory と
   Go/No-Go が docs に記録されている。
2. 案 A の場合:
   - subframe からの message が native に拒否される negative test が Linux で PASS。
   - main-frame の positive test が同じ fixture で PASS。
   - macOS の同じ test と結果を混同しない。
3. 案 B の場合:
   - profile restriction と unsupported 条件が docs/0057 / manifest / host の
     diagnostic に一致する。
   - subframe/srcdoc/iframe/unknown-frame の negative test が Linux で PASS
     または NOT RUN と理由付きで記録される。PASS に数えない。
   - `frameAuthority:"unproven"` が report に残り、`compatible:false` を維持。
4. どちらの場合も `tests/linux-host-frame.test.cjs` と共有 5 テストが回帰しない。
5. CI の `linux-native` / `moonbit` / `macos` が green。macOS の PASS を
   Linux の frame authority の証拠にしない。
6. `compatible:false`、strict BLOCKED、元 preload NOT_EXECUTED、A〜J 非昇格。

## 停止条件・リスク

- public API で frame を取得できないことを「nonce で安全」と読み替えない。
  その場合は案 B の明示的 restriction を選ぶ。
- web extension 経由の relay は、extension の追加・配布・sandbox 条件が
  変わるため、実装前に profile / packaging への影響を review する。
- frame ID の lifetime と reload generation の対応を確認せず、文字列 ID を
  authority にしない。
- Linux の結果を macOS/WebKit の互換性証拠にしない。macOS は参照実装の
  まま、同じ fixture を別 lane で実行する。

## 次の作業

1. `platform/linux/NativeHost.c` の message handler と
   `docs/0057` の「NOT PROVEN」記述を読み直す。
2. WebKitGTK 2.52.6 の header / GIR で frame 情報の有無を確認する。
3. subframe/srcdoc fixture を作り、現行 host が何を拒否できるか実測する。
4. Go/No-Go を決め、案 A または案 B の bounded PR にする。
5. 実装後に `linux-native` の共有 test / 負例 / docs を更新し、CI を確認する。

## 出典

- [docs/0057: Linux GTK/WebKitGTK native host](../../docs/0057-linux-native-host.md)
- [0018: Windows/Linux backend](../polished/0018-windows-linux-and-backend-contract.md)
- [0007: contextBridge feasibility and security](../polished/0007-context-bridge-feasibility-and-security.md)
- [0015: Oracle/CI/evidence](../polished/0015-oracle-ci-and-evidence.md)
- [PR #15](https://github.com/f4ah6o/electron.mbt/pull/15)
- WebKitGTK 2.52.6 headers/GIR on Ubuntu 24.04 (`webkit_user_content_manager_register_script_message_handler_with_reply`, `script-message-with-reply-received`, `WebKitFrame`, `WebKitWebPage`).

## 注記

- 2026-10-21: PR #15 の Linux native host slice を前提に、未証明の frame/sender
  authority を独立した open issue として記録した。実装・互換性の主張ではない。
- `issues/open` の番号はこのディレクトリ内の追跡番号であり、`issues/polished`
  の番号体系を置き換えない。
