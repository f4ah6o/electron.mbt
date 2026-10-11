# M0 isolated synchronous contextBridge feasibility — public WKWebView diagnostic

Status: **feasibility probe only; M0 OPEN, no production `contextBridge`.** PR #2 remains Draft and `compatibility/manifest.json` keeps `compatible:false` and row C planned. The unchanged Electron 44.7.0 oracle exercises an actual Electron preload; this diagnostic intentionally does **not** implement that preload in electron.mbt.

## Pinned Electron 44.7.0 sandboxed preload reference

The independent `fixtures/oracle` Electron 44.7.0 fixture runs an actual
sandboxed CommonJS preload (`sandbox:true`, `contextIsolation:true`,
`nodeIntegration:false`) without changing application source at launch.
`scripts/oracle.cjs` now validates the recorded first-script synchronous
return/throw, asynchronous Promise return/fulfillment/rejection, copied/frozen
nested data, callback observations, explicit subscription-disposer behavior,
and realm primordial isolation instead of checking only the runtime version
and process completion. It also records synchronous-throw and Promise-rejection
Error names, JavaScript value types, object tags, and whether each rejection
is an `instanceof Error` in the page realm. The pinned Electron 44.7.0 / Node 24.21.0 / macOS 15 arm64 run
[Runtime contracts #38108133056](https://github.com/f4ah6o/electron.mbt/actions/runs/38108133056)
observed both errors with `name:"Error"`, `typeofValue:"object"`,
`objectTag:"[object Error]"`, and `pageRealmInstance:true`. The validator
now requires those actual results for this specific oracle version. This
does **not** assert that WebKit implements the same proxy, or that every
Electron version guarantees the same cross-realm error representation. Portable negative tests are in
`tests/m0-electron-oracle-evidence.test.cjs`; the real observation is collected
by the pinned-Electron macOS CI step.

Previous Electron #128 evidence recorded
`callbackValues:["first","second"]`: `Set.delete(callback)` in the isolated
preload did **not** remove the callback passed again from page world. This is
a pinned-runtime observation, **not** a guarantee that callback identity is
maintained across separate `contextBridge` calls. The fixture now tests a
separate approach: `subscribe(callback)` retains its wrapper in preload
and returns an idempotent disposer closure to the page. The validator
requires once-only disposal, and explicitly expects direct removal using
the original callback to fail in this pinned reference. Real macOS CI
must establish that the new disposer actually works; unit fixtures alone
are not runtime evidence.

**Reference only:** an Electron oracle PASS does not prove the WKContentWorld
candidate implements any bridge operation. Shared-DOM reply forgery and
page-induced native echo still block M0. Preserve `contextBridge:NOT_IMPLEMENTED`,
manifest row C `planned`, `compatible:false`, Draft and ordinary
`run`/`pack` fail-closed.

## Reproducible real macOS observation

Run `node scripts/m0-bridge-probe.cjs` after installing Xcode command-line tools on a macOS machine with a working WindowServer. The test-only runner compiles `platform/macos/M0BridgeProbe.m` to a distinct `dist/M0BridgeProbe.app` using public AppKit/WebKit API, loads `fixtures/worlds/m0-page.html` and injects `fixtures/worlds/m0-preload.js` only into a named `WKContentWorld` at document start. The production M1 native host, unchanged CJS application and Node loader are **not modified**. No Electron/CEF fallback, private WebKit selector, disabled sandbox or page-world preload is involved.

The diagnostic captures the very first page script, confirms the isolated variable and native reply handler are not exposed in page world, verifies isolated JavaScript primordials are intact after page tampering, and repeats the page in a freshly reloaded document. It also measures a **page-authored raw DOM event** (not the test proxy) which induces the isolated-world listener to call the native no-privilege echo handler: native `WKScriptMessage.frameInfo.isMainFrame` describes the immediate isolated-world caller, **not** the untrusted page that initiated the shared-DOM event. The native diagnostic distinguishes document-start and page-induced messages for measurement only; the self-declared source label is not a security credential. A separate **test-only document grant** is minted by the native navigation policy for each allowed main-frame document. It is returned only to the isolated world by `WKScriptMessageHandlerWithReply`, kept in an isolated lexical closure, and checked by a second native echo. A deliberately invalid grant and the prior document's grant (sent to the new isolated document solely for this negative replay fixture) must fail. The actual grant strings are never written to DOM, stdout, or evidence. This establishes only an isolated grant round trip and a narrow native per-navigation replay rejection on the tested WebKit—not a page-initiator identity, an unchanged preload proxy, or production renderer authorization. It separately invokes `WKScriptMessageHandlerWithReply` from the isolated world: `postMessage` returns a **Promise**, not the return value of an arbitrary synchronous JavaScript function. The test-only shared-DOM candidate sends a request through an `EventTarget.dispatchEvent` listener attached by the isolated world and reads its reply from DOM attributes immediately. Native code checks the isolated counter independently so that a page-fabricated reply is not mistaken for a cross-world invocation.

A successful **probe execution** writes `evidence/m0-bridge-feasibility.json` and emits `probe:m0-isolated-sync-feasibility` with `status:PASS`, `contextBridge:NOT_IMPLEMENTED`, `compatibilityGate:OPEN` and `compatible:false`. Candidate results are independent booleans, not implicit success claims. The report includes two real WKWebView document observations, OS/WebKit/SDK/architecture, page-visible and isolated-only state, separately counted document-start and page-induced native replies, independent grant issue/accept/reject counters, child-frame denial counts and isolated child Promise observations, a bounded polling interval for asynchronous grant/frame completion, and a bounded source/asset hash check. The Node evidence validator rejects inconsistent derived synchronous/reload/induced-message claims and mismatched native reply totals rather than treating a forged or stale aggregate flag as proof. `node scripts/m0-bridge-probe.cjs --build-only` compiles without claiming runtime acceptance. Running on Linux reports `NOT_RUN` with exit 2. CI records the raw evidence on `macos-15` and retains the full existing MoonBit/Node/macOS acceptance suite.

### Direct subframe native rejection

The test-only M0 probe loads an `m0-frame.html` iframe beside the main
document and injects a separate isolated script into each frame. The child
issues a `document-start` native call with the same claimed source as the
main isolated script. Native checks the actual `WKScriptMessage.frameInfo`
and frame URL, rejects the direct child request, and counts denials
independently of accepted main-frame traffic. The native diagnostic evaluates
the child's isolated Promise result using that exact `WKFrameInfo`, and
requires both rejection observations on **both** document loads. The child
never receives a document grant. The page-visible script does not receive
the native handler.

This is a narrow immediate-frame distinction, **not page-initiator
authentication**: a page or frame may indirectly induce the authorized main
isolated handler through page-exposed APIs. Shared-DOM reply forgery remains.
These additions do not change the production AppKit host or implement a
privileged renderer API.

## M0 requirements versus what the candidate actually measures

| M0 requirement from issue 0001 §6.2 | Tested observation | Still missing |
| --- | --- | --- |
| Synchronous function result and synchronous throw | If public DOM event delivery synchronously traverses worlds on this OS/WebKit, a *page-authored* test proxy can return and reconstruct an error before the next microtask | An unchanged Electron preload `contextBridge.exposeInMainWorld()` function proxy and trusted cross-world return/error semantics |
| Promise-returning functions | `WKScriptMessageHandlerWithReply` exposes an asynchronous JavaScript Promise within the isolated world | Preserving actual preload function Promise identity, fulfillment/rejection and error types across worlds |
| Callback identity, registration and removal | A page-side callback registry dispatches an integer/string callback ID through nested DOM events | Proxying real function objects and preserving callback identity/lifetime across isolated realms, including nested reentrancy and revocation |
| Frozen copies | Not implemented in this test-only candidate | Immutable/clone semantics of real cross-realm exposure |
| Isolated primordials and hidden privileged handler | Test checks that changing page `Array.prototype.map` does not change the isolated copy, and page cannot access the named native message handler; a page-originated shared-DOM event nevertheless induces an isolated-world native echo | Native attestation of the original page initiator, plus a full threat-model review of a privileged preload loader |
| Navigation/reload revocation | Real WKWebView reload re-runs document-start code, resets isolated state, rotates a test-only native grant, rejects an invalid grant and a replay of the old grant in the new isolated document | Proving stale external proxies/callbacks/pending requests cannot reach the next document; enforcing equivalent lifetime rules in production MoonBit native sender/frame authority |

**Native grant scope:** A successful grant echo demonstrates only that an isolated-world script received an opaque native-issued value. The test-only native handler checks both the actual `WKScriptMessage.frameInfo.isMainFrame` and this value. The page can still cause isolated code to run by emitting a shared DOM event; the native observer cannot distinguish that indirect initiation merely by inspecting the isolated sender or its valid grant. The previous grant is handed to the second isolated test document for replay testing only; doing so is not permitted in a production capability loader.

**Critical security negative:** the page can install a later event listener and overwrite the reply on the shared DOM after the isolated listener responds, and can synthesize invocation events itself. The additional test-only echo operation checks whether that same synthetic event causes the isolated world to send a main-frame-attributed native message even though the page cannot directly access its message handler. This native reply is asynchronous and gives the page no privileges in the probe. The native observer cannot infer the initiating realm from `frameInfo` or a source field supplied by JavaScript. The candidate deliberately measures whether the page reads that forged value. Therefore the shared DOM, a CustomEvent, page-supplied token, DOM attribute and callback ID are **not** sender or response authentication. Even if the synchronous primitive probe succeeds, this is not a privileged IPC transport and must never be promoted to production based on its timing result. Tests independently confirm the isolated-side invocation count, but this test-only counter does not itself establish an authenticated page sender.

## Architecture verdict and next acceptance gate

1. The current public `WKContentWorld` APIs create isolated JavaScript namespaces while sharing the document DOM; they do not automatically create a cross-realm function proxy.
2. A native `WKScriptMessageHandlerWithReply` does not supply a synchronous in-page function result. Blocking the WebKit/UI threads awaiting a reply, calling `evaluateJavaScript` from page-world synchronous code, running preload in pageWorld, or treating a page-mutable DOM event as native sender attestation is **not accepted**.
3. To close M0, implement and demonstrate an *unchanged sandboxed CJS preload* with `contextBridge.exposeInMainWorld` against the **same** first-script/callback/Promise/frozen-data fixture used by pinned Electron 44.7.0. Use a separate, justified native-attested sender/frame/document contract and prove event ordering, nested and reentrant calls, callback identity and navigation revocation. The resulting value must not be a Promise where Electron returns synchronously.
4. If these conditions cannot be satisfied with public WebKit without unsafe shared-DOM trust, keep M0 OPEN and document an explicit architecture tradeoff/alternative backend. Do not mark row C `verified` or enable normal `run`/`pack` simply because this isolated diagnostic is green.

## Primary references

- [Apple WKContentWorld](https://developer.apple.com/documentation/webkit/wkcontentworld) — isolated JavaScript namespaces, shared DOM, document-scoped state.
- [Apple WKScriptMessageHandlerWithReply](https://developer.apple.com/documentation/webkit/wkscriptmessagehandlerwithreply) and [WKUserContentController reply handler registration](https://developer.apple.com/documentation/webkit/wkusercontentcontroller/addscriptmessagehandler%28_%3Acontentworld%3Aname%3A%29?language=objc) — asynchronous native reply channel scoped to a content world.
- [Electron contextBridge API](https://www.electronjs.org/docs/latest/api/context-bridge) — synchronous cross-world functions, copied/frozen values and callbacks.
- [Parent feasibility and security contract](../issues/open/0001-electron-compatible-lightweight-runtime.md) §6.2 and §10.
