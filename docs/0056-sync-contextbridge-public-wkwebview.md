# 同期 contextBridge: public WKWebView 設計と bounded PoC

Date: 2026-10-20 JST
Status: **設計・診断PoC。strict実装はBLOCKED、compatible:falseを維持**
Branch: research/sync-contextbridge-contract-20261020
Base: main `394b33a3ca819d4a76392b95785a2ba7f0980dcd`

本文は設計・診断の記録であり、production `contextBridge` の実装・互換性の主張ではない。
`contextBridge` は `NOT_IMPLEMENTED`、M0 は OPEN、strict profile は BLOCKED、元 preload は `NOT_EXECUTED`、`compatible:false` を維持する。

## 1. 結論

public WKWebView API には、page world から isolated `WKContentWorld` の JavaScript 関数を同期的に呼び出す engine-level proxy がない。
唯一の同期 cross-world channel は共有 DOM の `dispatchEvent` であり、値は data-only で、page から観測・改変できる。
したがって strict の実装は、共有 DOM の同期 channel に response integrity、document authority、descriptor admission、lifetime を重ねる設計になる。
この設計は B5/B6 の test-only / experimental transport として動作するが、エンジン proxy ではなく、独立 review と strict runtime の証跡がないため production へ昇格できない。

2026-10-20 の bounded PoC は frame/origin scope を測った。
main frame にだけ shim を注入したとき、same-origin child は `parent.<key>` 経由で親の page-world API を同期呼び出しできた。
sandboxed / opaque-origin child は same-origin policy により拒否された。
native が見るのは parent document であり、child 単位の sender attestation ではない。
same-origin child が受け取る Error は parent realm の object で、child realm の `instanceof Error` は false だった。
この error realm の差は strict 契約の未達項目として残す。

結論は **strict BLOCKED** である。
same-origin child の継承は web platform の origin model に沿う観測であり、Electron の child frame 互換や native sender 認可の証明ではない。
production host は main-frame-only のままで、Electron-compatible child frame は未達である。

## 2. 対象と非対象

対象:

- public WKWebView API だけで同期 contextBridge の契約をどこまで満たせるかの設計。
- B5 test-only transport の frame/origin scope の実測。
- same-origin child、sandboxed/opaque child、native report lane の境界の記録。

非対象:

- production `contextBridge` の実装・有効化。
- 元 preload の実行、`ipcRenderer` / `webUtils` / Node globals の完全実装。
- private WebKit selector、page-world preload、isolation/sandbox の無効化、CEF/Electron の hidden fallback。
- production host の subframe navigation policy の変更。
- strict profile の gate 解除、互換性 row の昇格。
- Electron baseline differential、独立 security review、非 macOS 実行。

## 3. strict 契約

strict は「unchanged Electron preload/page が同じ観測可能な契約を満たす」こととする。
test-only の shim が一部の値を再現しただけでは strict ではない。

| 契約 | 必須の観測 |
| --- | --- |
| first-script | 最初の page script で API が存在し、後注入ではない |
| 同期 return/throw | 関数呼び出しが同じ turn で値または例外を返し、Promise に置換されない |
| function/callback | 実関数の identity、登録・解除、nested/reentrant、callback 内 throw |
| Promise | source/target の fulfill/reject、microtask ordering、thenable の扱い |
| frozen copy | 公開 data の copy と nested freeze。source object の freeze ではない |
| Error realm | name/message/tag と caller realm の `instanceof` を pinned oracle と照合する |
| integrity | page が reply、session、descriptor、settlement を偽造できない |
| authority | native が actual document/frame/grant を照合し、renderer の自己申告を信頼しない |
| lifetime | navigation/reload/destroy で旧 API、callback、Promise、grant が新 document に届かない |
| bounds | payload、depth、nodes、strings、handles、queues が bounded |
| frame/origin | document/origin scope と child frame の許可・拒否が明示される |
| self-DoS | page の busy loop が native control を無期限に停止させない |

security invariant:

- page から isolated preload の closure、secret、grant、native handler が見えない。
- page が同期 reply を偽造しても authentic な値へ到達できない。
- native は `WKScriptMessage` の actual main frame、URL、generation、grant を検証する。
- 不明な値・過大な値・不明な descriptor は fail closed にする。
- 同期 API のために UI thread を無期限に block しない。

## 4. public WKWebView API の inventory

`evidence/wksyncbridge.json` の 7 candidate は、この build で同期 function proxy を提供しなかった。

| API / channel | 観測 | 同期 proxy としての可否 |
| --- | --- | --- |
| cross-world function reference | 両方向で `undefined` | 不可。world は DOM を共有するが JS object を共有しない |
| `WKScriptMessageHandler` / `WithReply` | 戻り値は Promise、settle は later turn | 不可。同期 return にならない |
| `evaluateJavaScript` / `callAsyncJavaScript` | completionHandler は later run-loop turn | 不可。native から同期に読めない |
| shared-DOM `dispatchEvent` | 同期に isolated listener へ届く | 同期だが data-only。callable を運べず throw も伝播しない |
| sync XHR + `WKURLSchemeHandler` | JS を block して string body を返す | 同期だが native URL task 宛て。function proxy ではない |
| `confirm` / `alert` | UIDelegate へ同期。bool/void のみ | 任意値を返す function channel ではない |
| `window.prompt` | null を返し delegate が呼ばれない | 不可 |
| `JSContext` | WKWebView の content world を参照できない別 VM | 不可 |
| private SPI | public API ではない | 対象外 |

この inventory から、strict の候補は shared-DOM の同期 channel に integrity を重ねる方式に限定される。
それは Electron の V8/Blink cross-context proxy ではなく、値の copy と JS leaf の handle で関数を模擬する方式である。

## 5. 候補設計

### 5.1 owner と realm

| owner | 所有するもの | 所有してはならないもの |
| --- | --- | --- |
| MoonBit core | window/document generation、exposure authority、handle/quota、release/revocation、request terminal、diagnostics | JS function body、DOM/native object |
| native host | `WKWebView` / `WKContentWorld`、document-start script、`WKScriptMessage` の actual frame/URL、document grant | renderer の自己申告 sender |
| isolated preload world | unchanged preload の closure、`module.exports`、restricted `require('electron')` | independent grant の発行、page-world privilege |
| page world | 公開 proxy、copy された data、callback/disposer | isolated preload の closure、secret、grant、native handler |
| JS leaf | 実関数、callback、Promise の identity | 第二の policy/ID/quota state machine |

### 5.2 同期呼び出し

以下は B6-C/B7 の experimental candidate の設計要約である。
B5 の bounded PoC は、このうち共有 DOM の同期 channel、HMAC、per-document secret/grant の部分だけを使う。
descriptor preview と admitted-descriptor binding は B7 の experimental M1 transport の機構であり、B5 の frame stage は使っていない。

1. native が document start で host-owned page shim と isolated bridge を注入する。
2. page shim は `window.<key>` の getter を設置し、最初の page script から見えるようにする。
3. page の関数呼び出しは共有 DOM の `dispatchEvent` で isolated listener へ同期に届く。
4. isolated bridge は preload の実関数を呼び、結果または例外を envelope にする。
5. envelope は per-document secret の HMAC で保護され、page shim が同じ turn で検証して return/throw する。
6. descriptor は navigation 前に preview され、native と page shim が bytes/function count/SHA-256 を照合する。
7. navigation ごとに secret と grant を更新し、旧 grant の replay を拒否する。

### 5.3 何を証明していないか

この設計は engine-level proxy ではない。
関数は isolated world の実 closure を JS registry に保持し、page には handle を渡す leaf 実装である。
値は copy され、Promise と callback は bridge の handle で模擬される。
HMAC と shared-DOM transport は test-only / experimental であり、独立した primitive/protocol review を受けていない。
したがって「同じ API 形状で動く」ことと「Electron の synchronous contextBridge と互換」であることを分ける。

## 6. frame/origin bounded PoC

### 6.1 問い

main frame にだけ page shim を注入したとき、page-world API の scope は frame か、document/origin か。
same-origin child は `parent.<key>` で親の API を呼べるか。
sandboxed / opaque-origin child は拒否されるか。
native は child 由来の呼び出しを識別できるか。

### 6.2 方法

B5 probe に frame stage を追加した。
frame page と 2 つの child は loopback HTTP の同一 origin から配信する。
`file://` の origin は環境依存で same-origin の負例を誤判定し得るため、same-origin の判定を file URL に依存させない。
main frame の page shim は `forMainFrameOnly:YES` のままである。
same-origin child は sandbox なしで `m0-cb-same-origin-child.html` を読み、`parent.fixture` を呼ぶ。
sandboxed child は `sandbox="allow-scripts"` で `m0-cb-child.html` を読み、同じ `parent.fixture` を試す。
両 child の `postMessage` は parent が `event.source` と `event.origin` で照合する。
native は page world の `globalThis.m0ContextBridgeFrames` を bounded に読み、typed evidence にする。
frame stage が incomplete の場合は `ELECTRON_MBT_M0_CB_FRAME_OBSERVATION` で FAIL し、部分的な go を出さない。

### 6.3 結果

環境: macOS 26.5.2 (Build 25F84)、arm64、SDK 26.5、WebKit `21624.2.5.11.8`、Node v24.22.0。
Electron oracle は 44.7.0 を参照値として記録したが、この実行では differential を実行していない。

| 観測 | 結果 |
| --- | --- |
| same-origin child の `ownApiType` | `undefined`（child 自身には shim がない） |
| same-origin child の `parentApiType` | `object` |
| same-origin child の `access` | true |
| same-origin child の `syncValue` / type | `42` / `number` |
| same-origin child の `syncThrow` | true |
| same-origin child の `throwName` / message | `Error` / `fixture-sync-error` |
| same-origin child の `childRealmError` | false |
| same-origin child の `parentRealmError` | true |
| same-origin child の native handler 可視性 | hidden |
| same-origin child の origin / message source | match |
| sandboxed child の opaque origin | true |
| sandboxed child の `parent.fixture` access | denied |
| sandboxed child の native handler 可視性 | hidden |
| sandboxed child の message source | match |
| native の child report 拒否数 | 0（child から report lane へ到達しなかった） |
| frame observation の complete | true |
| `hypothesisSupported` | true |

### 6.4 解釈

page-world API は frame 単位ではなく document/origin scope である。
main frame に注入された getter は same-origin child から `parent` 経由で到達でき、child は通常の WindowProxy の same-origin access として親の関数を呼ぶ。
sandboxed / opaque-origin child は same-origin policy で拒否される。
native が見るのは parent document の isolated caller であり、child 単位の native sender attestation ではない。
same-origin child の呼び出しを「child が認可された」と表示してはならない。
それは parent document が公開した API の通常の same-origin 利用である。

same-origin child が受け取る Error は parent realm の object で、child realm の `Error` とは constructor identity が異なる。
`childRealmError:false` / `parentRealmError:true` はこの差の実測である。
strict の Error realm 契約を same-origin child にまで広げるなら、caller realm の Error を再構成する設計が必要になる。
Electron oracle の same-origin child error realm はこの実行では NOT RUN であり、互換性は主張しない。

production host は subframe navigation を拒否する main-frame-only のままである。
この PoC は test-only の page shim の scope を測ったもので、production host の child frame 許可や Electron child-frame parity を変更しない。
same-origin child を許可する strict profile にするなら、native の document/frame policy、report lane、child からの間接呼び出しの扱いを別途設計する必要がある。

## 7. なぜ strict は BLOCKED か

1. public WKWebView に engine-level synchronous cross-world function proxy がない。
2. 候補 transport は shared-DOM/HMAC の test-only / experimental 実装で、独立した security review がない。
3. same-origin child の error realm が parent realm のままで、strict の caller-realm Error 契約を満たしていない。
4. production host は main-frame-only で、Electron-compatible child frame の証跡がない。
5. full preload globals、`ipcRenderer`、`webUtils`、arbitrary/dynamic preload が未実装。
6. strict nodeless runtime への port がない。
7. CPU/memory fault、page self-DoS の full matrix がない。
8. Electron baseline differential と独立 review が NOT RUN。

決定:

- `contextBridge:NOT_IMPLEMENTED` を維持する。
- M0 は OPEN のままにする。
- strict profile は BLOCKED のままにする。
- `compatible:false` を維持し、互換性 row を昇格しない。
- 通常 `run` / `pack` は fail-closed のままにする。

## 8. 証跡と再現

実行したコマンド:

```sh
node scripts/m0-context-bridge-probe.cjs --build-only
node scripts/m0-context-bridge-probe.cjs
node --test tests/m0-context-bridge-evidence.test.cjs tests/m0-context-bridge-codec.test.cjs
npm run build
npm test
moon test --target js
moon test --target native
node scripts/verify-state.cjs
```

結果:

| コマンド | 結果 |
| --- | --- |
| `--build-only` | PASS（build のみ、execution NOT_RUN） |
| full B5 probe | PASS、`decision:go`、checkpoint 1/2 PASS、framePolicy complete / supported |
| B5 evidence + codec tests | 17 pass / 0 fail |
| `npm test` | 492 pass / 0 fail |
| `moon test --target js` | 145 pass / 0 fail |
| `moon test --target native` | 178 pass / 0 fail |
| `verify-state` | 19 checks / 0 failed、overall `NOT_READY`（期待値） |
| Electron baseline differential | **NOT RUN** |
| independent security review | **NOT RUN** |
| 非 macOS | **NOT RUN** |

frame stage の source hash:

| source | SHA-256 |
| --- | --- |
| `fixtures/worlds/m0-cb-frames.html` | `b421a651a7a727cb41c24b3cddc71d32125eb1d074f0d0fe518b0a471299ad8d` |
| `fixtures/worlds/m0-cb-same-origin-child.html` | `d01710995ad20e05f3e04609d846ab576dd7dc58fc04cbcd6a52060c7c75d31b` |
| `fixtures/worlds/m0-cb-page-shim.js` | `80e32a7df9ed4e80eb8bfab5292a4e92732f6320ea3e37abe1ffa1d17cd56844` |
| `fixtures/worlds/m0-cb-isolated.js` | `6257fd52f124baf7d11fb0f55c306e29978f690281f2abb7d85e9958f876a360` |
| `fixtures/oracle/preload.cjs` | `6b3d53ca6aecc2cd2d4e7a5b598ff18599f7bb7d54decec9f58b4cf11f7b7543` |

raw evidence は `evidence/m0-context-bridge.json`（CI artifact、repository には commit しない）。

## 9. 残作業と再開条件

strict を再評価するには、少なくとも次を同じ candidate で揃える必要がある。

1. shared-DOM/HMAC transport の独立した security review。
2. same-origin child を含む Error realm の設計と pinned Electron oracle の differential。
3. Electron-compatible child frame policy の決定と production host の実装、または明示的な profile restriction。
4. full preload globals、`ipcRenderer`、`webUtils`、arbitrary/dynamic preload の扱い。
5. strict nodeless runtime への port と page-admission ordering。
6. CPU/memory fault、page self-DoS、navigation variant の matrix。
7. Electron baseline differential と、profile を gate する独立 review。

これらが揃うまで、same-origin child の継承や sandboxed child の拒否を「strict 成立」と読み替えない。

## References

- [Issue 0007: contextBridge feasibility and security](../issues/polished/0007-context-bridge-feasibility-and-security.md)
- [M0 contextBridge feasibility](0003-m0-contextbridge-feasibility.md)
- [B5 contextBridge spike](0038-m0-context-bridge-spike.md)
- [B6 strict contextBridge design](0039-b6-strict-context-bridge.md)
- [B7 strict profile admission](0041-b7-strict-profile-admission.md)
- [Apple WKContentWorld](https://developer.apple.com/documentation/webkit/wkcontentworld)
- [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)
