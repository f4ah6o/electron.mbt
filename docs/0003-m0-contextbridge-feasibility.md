# M0 isolated synchronous contextBridge feasibility — public WKWebView diagnostic

Status: **feasibility probe only; M0 OPEN, no production `contextBridge`.** PR #2 remains Draft and `compatibility/manifest.json` keeps `compatible:false` and row C planned. The unchanged Electron 44.7.0 oracle exercises an actual Electron preload; this diagnostic intentionally does **not** implement that preload in electron.mbt.

## Reproducible real macOS observation

Run `node scripts/m0-bridge-probe.cjs` after installing Xcode command-line tools on a macOS machine with a working WindowServer. The test-only runner compiles `platform/macos/M0BridgeProbe.m` to a distinct `dist/M0BridgeProbe.app` using public AppKit/WebKit API, loads `fixtures/worlds/m0-page.html` and injects `fixtures/worlds/m0-preload.js` only into a named `WKContentWorld` at document start. The production M1 native host, unchanged CJS application and Node loader are **not modified**. No Electron/CEF fallback, private WebKit selector, disabled sandbox or page-world preload is involved.

The diagnostic captures the very first page script, confirms the isolated variable and native reply handler are not exposed in page world, verifies isolated JavaScript primordials are intact after page tampering, and repeats the page in a freshly reloaded document. It separately invokes `WKScriptMessageHandlerWithReply` from the isolated world: `postMessage` returns a **Promise**, not the return value of an arbitrary synchronous JavaScript function. The test-only shared-DOM candidate sends a request through an `EventTarget.dispatchEvent` listener attached by the isolated world and reads its reply from DOM attributes immediately. Native code checks the isolated counter independently so that a page-fabricated reply is not mistaken for a cross-world invocation.

A successful **probe execution** writes `evidence/m0-bridge-feasibility.json` and emits `probe:m0-isolated-sync-feasibility` with `status:PASS`, `contextBridge:NOT_IMPLEMENTED`, `compatibilityGate:OPEN` and `compatible:false`. Candidate results are independent booleans, not implicit success claims. The report includes two real WKWebView document observations, OS/WebKit/SDK/architecture, page-visible and isolated-only state, native reply count, and a bounded source/asset hash check. `node scripts/m0-bridge-probe.cjs --build-only` compiles without claiming runtime acceptance. Running on Linux reports `NOT_RUN` with exit 2. CI records the raw evidence on `macos-15` and retains the full existing MoonBit/Node/macOS acceptance suite.

## M0 requirements versus what the candidate actually measures

| M0 requirement from issue 0001 §6.2 | Tested observation | Still missing |
| --- | --- | --- |
| Synchronous function result and synchronous throw | If public DOM event delivery synchronously traverses worlds on this OS/WebKit, a *page-authored* test proxy can return and reconstruct an error before the next microtask | An unchanged Electron preload `contextBridge.exposeInMainWorld()` function proxy and trusted cross-world return/error semantics |
| Promise-returning functions | `WKScriptMessageHandlerWithReply` exposes an asynchronous JavaScript Promise within the isolated world | Preserving actual preload function Promise identity, fulfillment/rejection and error types across worlds |
| Callback identity, registration and removal | A page-side callback registry dispatches an integer/string callback ID through nested DOM events | Proxying real function objects and preserving callback identity/lifetime across isolated realms, including nested reentrancy and revocation |
| Frozen copies | Not implemented in this test-only candidate | Immutable/clone semantics of real cross-realm exposure |
| Isolated primordials and hidden privileged handler | Test checks that changing page `Array.prototype.map` does not change the isolated copy, and page cannot access the named native message handler | Full threat-model review of a privileged preload loader |
| Navigation/reload revocation | Separate real WKWebView reload re-runs document-start code and resets the per-document isolated event counter | Proving stale external proxies/callbacks/grants cannot reach the next document under authenticated native frame identity |

**Critical security negative:** the page can install a later event listener and overwrite the reply on the shared DOM after the isolated listener responds, and can synthesize invocation events itself. The candidate deliberately measures whether the page reads that forged value. Therefore the shared DOM, a CustomEvent, page-supplied token, DOM attribute and callback ID are **not** sender or response authentication. Even if the synchronous primitive probe succeeds, this is not a privileged IPC transport and must never be promoted to production based on its timing result. Tests independently confirm the isolated-side invocation count, but this test-only counter does not itself establish an authenticated page sender.

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
