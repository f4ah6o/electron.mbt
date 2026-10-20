# M0 isolated synchronous contextBridge feasibility — public WKWebView diagnostic

Status: **feasibility probes only; M0 OPEN, no production `contextBridge`.** The separate B5 repaired-primitive spike recorded a `go` on one macOS/WebKit build (see below), but it is test-only and does not close M0. The unchanged Electron 44.7.0 oracle exercises an actual Electron preload; this diagnostic intentionally does **not** implement that preload in electron.mbt. `compatibility/manifest.json` keeps `compatible:false` and row C planned, and ordinary `run`/`pack` stay fail-closed.

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

### Native-grant-checked indirect invocation

The test-only shared-DOM page requests a native no-privilege echo *before* its
isolated handler has received the current document grant. The isolated world
queues that request, obtains the grant through the asynchronous native reply,
and sends a `dom-triggered` native call with the private grant **without
revealing the grant to the page**. Native checks both the actual main-frame
`WKFrameInfo` and the current opaque grant; only then does it count and
acknowledge the invocation. The M0 report separately counts
`nativeGrantDomTriggeredAcceptedCount`, and the portable validator ties that
count to the accepted page-induced calls and the derived
`pageInducedWithValidIsolatedGrant` observation. A reload uses a new grant.

This is a negative security diagnostic, not an API to expose in production.
Even a native-validated current grant only authenticates the isolated handler
that possesses it; the page-authored DOM event can still *indirectly* invoke that
handler. Grant checks protect against direct unauthorized calls and stale-grant
replay, but do not authenticate the original page/frame that initiated a
shared-DOM event, and cannot fix page-forgeable synchronous return values.
No privileged operation is wired to this echo; M0 remains OPEN.

### Sandboxed-child indirect call through main-frame handler

The diagnostic now also loads its actual child iframe with `sandbox="allow-scripts"`
and **without** `allow-same-origin`, giving the child page an opaque origin.
Its page-world script, which cannot access the isolated native handler, sends a
`postMessage` to the main page. The parent observes the child frame's
`MessageEvent.source` and opaque `origin`, then forwards this **untrusted**
message into the shared DOM request listener. The main isolated world echoes
through its own still-private, current document grant. Native sees the
**authorized main-frame isolated caller**, not the child which started the
communication. A separate native read of the actual child `WKFrameInfo`'s
*page world* records that the sandboxed child script sent its message while
the native handler remained hidden. The child-frame's **direct** native call
continues to be denied by actual `WKScriptMessage.frameInfo`.

The evidence separately records the parent's page-origin/source observations,
the child page-world observation, isolated page/child-relay echo requests and
settlements, and the native grant-validated main-frame echo aggregate. The
parent-provided origin/source labels and DOM operations **are not** elevated to
native-attested initiator identity; the native caller still cannot distinguish
the relayed child request. The test-only echo has no privileged effect. Both
document loads remain source-hash checked, and no grant value is exposed to
the page or child. The candidate's
`sandboxedChildCanRelayGrantedNativeEcho` field is a narrowly scoped
*negative security-boundary observation*, never an implementation claim.

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

## B5 repaired-primitive spike (2026-10-18)

A separate test-only spike, [docs/0038](0038-m0-context-bridge-spike.md),
re-investigated the "repaired renderer public primitive" candidate required by
issue 0007 §5.1. It installed a page-world shim and a named isolated
`WKContentWorld` shim at document start, executed the **unchanged**
`fixtures/oracle/preload.cjs` through a test-only CommonJS wrapper, and used
synchronous shared-DOM `dispatchEvent` with a per-probe HMAC-SHA-256 secret
and a per-document session/grant. On macOS 26.5.2 / WebKit
`21624.2.5.11.8`, checkpoint 1 (first-script sync return/throw, forged replies
not accepted, secret not observable) and checkpoint 2 (callbacks,
nested/reentrant calls, Promise, frozen copies, isolated primordials,
sandboxed child denial, reload and stale-grant rejection) passed. The unchanged
oracle observation matched the pinned validator on both documents.

**Decision: `go` for the tested environment, not M0 closure.** The Electron
baseline differential was NOT RUN in the local spike because no pinned
Electron install was present; CI runs it after collecting the baseline. The
candidate is a test-only shared-DOM/HMAC mechanism, not Electron's
engine-level proxy. B6 must still implement a production preload/bridge leaf,
native document/frame authority, full value/error/callback/Promise semantics
and an independent security review. Strict profile stays blocked; the
original preload stays `NOT_EXECUTED`; `compatible:false` is unchanged.

B6-A has since implemented the MoonBit-owned exposure authority contract
(bounded API keys/descriptors, duplicate/quota/lifecycle policy and the
private `expose`/`release-exposure` dispatch), and B6-B adds an opt-in
experimental preload bridge environment that runs the unchanged oracle
preload, registers its exposure metadata through MoonBit and still does not
materialize a page API. B6-C adds an opt-in experimental synchronous transport in the M1 host and
reaches the pinned observation for the unchanged oracle preload/page; B6-D
adds an experimental semantics matrix and B6-E prepares the baseline/
security-review packet. Page-admission ordering, independent review,
arbitrary API keys, full preload globals, frame policy and page self-DoS
remain open. See
[docs/0039](0039-b6-strict-context-bridge.md). This is not an M0 or
strict-compatibility result.

A 2026-10-20 bounded extension measured the page shim's frame/origin scope over
one loopback-HTTP origin. A same-origin child reached the parent's page-world
API through `parent`, called `syncValue()` synchronously and received `42`, and
caught the synchronous `Error`; the Error was a parent-realm object, so the
child realm's `instanceof Error` was false. An opaque sandboxed child was denied
access and could not see the native handlers. The native probe still only sees
the parent document and requires the actual main frame. This is test-only
page-shim evidence: the production host remains main-frame-only, Electron child
frames are not accepted, and the child-realm Error contract remains open. See
[the public WKWebView design](0056-sync-contextbridge-public-wkwebview.md).

## Architecture verdict and next acceptance gate

1. The current public `WKContentWorld` APIs create isolated JavaScript namespaces while sharing the document DOM; they do not automatically create a cross-realm function proxy.
2. A native `WKScriptMessageHandlerWithReply` does not supply a synchronous in-page function result. Blocking the WebKit/UI threads awaiting a reply, calling `evaluateJavaScript` from page-world synchronous code, running preload in pageWorld, or treating a page-mutable DOM event as native sender attestation is **not accepted**.
3. To close M0, implement and demonstrate an *unchanged sandboxed CJS preload* with `contextBridge.exposeInMainWorld` against the **same** first-script/callback/Promise/frozen-data fixture used by pinned Electron 44.7.0. Use a separate, justified native-attested sender/frame/document contract and prove event ordering, nested and reentrant calls, callback identity and navigation revocation. The resulting value must not be a Promise where Electron returns synchronously.
4. If these conditions cannot be satisfied with public WebKit without unsafe shared-DOM trust, keep M0 OPEN and document an explicit architecture tradeoff/alternative backend. Do not mark row C `verified` or enable normal `run`/`pack` simply because this isolated diagnostic is green.

## Primary references

- [Apple WKContentWorld](https://developer.apple.com/documentation/webkit/wkcontentworld) — isolated JavaScript namespaces, shared DOM, document-scoped state.
- [Apple WKScriptMessageHandlerWithReply](https://developer.apple.com/documentation/webkit/wkscriptmessagehandlerwithreply) and [WKUserContentController reply handler registration](https://developer.apple.com/documentation/webkit/wkusercontentcontroller/addscriptmessagehandler%28_%3Acontentworld%3Aname%3A%29?language=objc) — asynchronous native reply channel scoped to a content world.
- [Electron contextBridge API](https://www.electronjs.org/docs/latest/api/context-bridge) — synchronous cross-world functions, copied/frozen values and callbacks.
- [B5 repaired-primitive spike](0038-m0-context-bridge-spike.md)
- [Parent feasibility and security contract](../issues/polished/0001-electron-compatible-lightweight-runtime.md) §6.2 and §10.
