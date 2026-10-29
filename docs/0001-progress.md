# Issue 0001 implementation ledger

Status: M0 in progress. This document does not replace or close `issues/polished/0001-electron-compatible-lightweight-runtime.md`.

## Connected execution paths

1. By default the CLI obtains filesystem metadata without loading application code, then invokes the compiled MoonBit `diagnose` export. MoonBit always retains the open-M0 diagnostic. `dispatch` delegates lifecycle calls to the same MoonBit core used by deterministic tests, and accepts a JSON envelope carrying the full window/document/grant/request surface so leaf adapters never re-implement core bookkeeping.
2. The synchronous transport probe uses a real Node-API addon, a private POSIX socketpair, an inherited child descriptor and a separate Node process. Calls use a single absolute monotonic deadline and never pump the Node event loop. Timeout, EOF, truncated or oversized reply closes the usable channel; late replies cannot be reused by a subsequent call. The original peer is a fault-injection fixture. The experimental M1 runner now also uses the same private channel with a standalone macOS AppKit/WKWebView process; this is not the full gpui-linked production host.
3. The WKWebView probe puts document-start code and its script-message handler in a named non-page `WKContentWorld`. The first page script checks that those globals/handlers are absent and replaces a page primordial. Native code observes the main frame, checks the isolated primordial and verifies that DOM is shared. A separate test-only M0 diagnostic compares a page-authored synchronous shared-DOM event candidate to the Promise-returning native reply handler on initial and reloaded real WKWebView documents. Its page-mutable reply can be forged, so the gate stays OPEN and it is never injected by the production runner. See [M0 feasibility report](0003-m0-contextbridge-feasibility.md).
4. The Electron fixture captures first-script bridge availability, synchronous return/throw, promises/rejections, frozen data, callback identity/removal and lifecycle traces without changing its sources. The baseline runner records actual observations rather than inventing an electron.mbt comparison. A baseline collection success is not differential compatibility.
5. The differential runner executes the same unchanged fixture under the facade and the compiled MoonBit core compares both observations key by key; environment fields (versions/platform/arch) are recorded, never compared. The current electron.mbt run aborts at `ipcMain.on` with `ELECTRON_MBT_UNSUPPORTED_API`, so the verdict is `diverged` and the gate stays open. The comparison runs in the macOS CI job after each baseline collection.
5. A runtime-owned facade resolves for `require('electron')` inside a launched app process. It drives `app` lifecycle through the compiled core (ready on the first macrotask after evaluation, cancelable quit, declared `getPath`/`setPath` subset) and fails closed with `ELECTRON_MBT_UNSUPPORTED_API` for every unimplemented surface. Per section 11 the default `userData` resolves under a runtime namespace (`<appData>/electron.mbt/<name>`), never the real Electron `<appData>/<name>`; `setPath('userData')` keeps Electron's existing-directory requirement. It is leaf glue, not an Electron compatibility proof.
6. The synchronous-bridge probe (`WKSyncBridgeProbe` → `evidence/wksyncbridge.json`) exercises every public API candidate for a page→world/native synchronous call and records each outcome: cross-world function references are `undefined` in both directions, `window.webkit.messageHandlers` is a Promise even in the `WithReply` variant, `evaluateJavaScript` completes on a later run-loop turn, the shared-DOM CustomEvent channel round-trips synchronously but cannot carry callables or propagate throws, `confirm`/`alert` reach the `WKUIDelegate` synchronously while `window.prompt` returns null without firing its delegate, and synchronous XHR to an inline-fulfilled `WKURLSchemeHandler` returns a string body — the only end-to-end synchronous channel observed, still not a function proxy. The verdict records `NO_PUBLIC_SYNC_PROXY`; the gate stays open.
7. The native-acceptance probe (`WKNativeProbe` → `evidence/wknative.json`) drives a real WKWebView through `NSWindow`/AppKit and records per-item traces. Executed here: window resize → real `resize` event and viewport change (devicePixelRatio static at 1 on a single display), DOM-synthesized input (`isTrusted=false`, inserts nothing), `CGEventPostToPid` + `NSApp sendEvent:` key events (both delivered `isTrusted` DOM input and text), a named NSPasteboard round-trip, and an in-process accessibility-role read. DOM clipboard read/write/copy is NOT_RUN by default and only runs with `ELECTRON_MBT_OS_PASTE_OPT_IN=1`; in that opt-in path a parked readback eval is recorded as stalled, not hidden. NOT_RUN: window focus/blur (the app could not take key status in this session), OS-level paste (posting Cmd+V writes the general pasteboard, so it runs only where `ELECTRON_MBT_OS_PASTE_OPT_IN=1`, e.g. CI), real IME composition, VoiceOver traversal, hardware input, second-display DPI (the NOT_RUN reason records the attached screen count). Both probes now score each candidate/trace against a recorded expectation at emit time and derive the report status from observations — `INCONCLUSIVE` on any unexpected outcome, `PARTIAL` when items did not execute or stalled — and `scripts/macos-probe.cjs` validates report content (schema, required entries, per-candidate/per-trace required observations, recomputed coverage, invariants, unexpected outcomes) instead of trusting exit 0, so malformed, self-inconsistent, or observation-missing reports flag the run.
8. Saved Electron baselines are admitted by the compiled MoonBit `validate_baseline` export before the candidate starts. The admission requires schema `1`, `baseline-collected`, `compatible:false`, the current fixture hash, exact manifest Electron/Node pins, `completed` status, no `abort` field, recorded platform/arch, Boolean module identity, and non-empty trace and measurement payloads. `scripts/oracle.cjs` validates the serialized baseline it writes; `scripts/differential.cjs` validates a saved baseline before launching the candidate and rejects unsupported values with `ELECTRON_MBT_INVALID_BASELINE`.
9. Runtime profile admission is owned by `core/profile.mbt` and exported as `validate_profile`. `compatibility/runtime-profiles-v1.json` keeps `desktop-core-v1`, `electron-nodeless-v1` (blocked), `electron-nodeless-adapted-v1` and `moonbit-native-v1` separate; unknown profiles and mismatched input/preload/runtime selections are rejected before app evaluation. `manifest.schema-v2.json` and the migration fixture preserve schema-1 rows without upgrading their claims. Evidence bundle v2, the Moji/jmd pinned app records, and the decision/risk/component ledgers add admission inputs; they do not create verified rows.
10. The main-local IPC stack from PR #9/#11/#12 is integrated: bounded `ipcMain` listeners and invoke handlers, duplicate/once/removal semantics, a MoonBit-owned ticket registry, and a tagged `invoke-json-undefined-v1` codec. Registration does not grant renderer authority, and the invoke comparison uses a synthetic trusted-host candidate, not native sender attestation. `ipcRenderer`, production renderer ingress, event replies and strict contextBridge remain unimplemented; `run`/`pack` stay closed.
11. The contextBridge prerequisite stack from PR #10/#13 is integrated: bounded native-backed JS handle registration/release/settlement, isolated bootstrap/preload worlds, one-shot native preload attestation, failed-preload denial, page/preload handler separation, same-URL reload and window-destroy revocation, and unsupported `require` failing closed. The public `contextBridge` API, synchronous cross-world function proxies and arbitrary page-initiated authority remain NOT_IMPLEMENTED.
12. QuickJS 2026-06-04 is vendored with a measured tarball SHA-256 and license hash. The native ABI in `bridges/embedded-js/` owns explicit engine/context/value leases and passes eval/throw, duplicate/release, stale-handle rejection, Promise job, interrupt, invalid UTF-8 and low-memory tests. QJS-05 callback/OOM exit and root-count evidence, sanitizer/ownership review, the CJS loader and scheduler integration remain open.
13. `runtime/embedded/scheduler.mbt` owns timer IDs, deadlines, registration order, cancellation, ref/unref deadlines and limits. Its pure tests cover deadline/registration ordering, cancellation, negative delay, non-monotonic rejection, limits and post-batch scheduling. It is not yet connected to QuickJS jobs, host events or shutdown.
14. `runtime/modules/module.mbt` owns in-memory module IDs/source hashes/state/dependency edges and bounds. `runtime/modules/resolve.mbt` resolves relative specifiers and registered package/node_modules paths over an immutable FileIndex, including extension/index/package-main, scoped/nested packages and escape rejection. `runtime/modules/builtins.mbt` classifies the planned Node subset and unsupported builtins and lists the first required symbols. `bridges/embedded-js/cjs_loader.mbt` executes a pre-resolved graph in one QuickJS realm and tests cycles, cache identity, `module.exports` reassignment, JSON modules and fail-closed admission. Builtin shims, dynamic require, conditional exports and the Node oracle remain open.
15. `runtime/runner` connects one QuickJS engine/context, the scheduler and the pre-resolved CJS entry point. Its native tests cover job execution, rejecting jobs, timer ordering, retained JS timer callbacks (invoke once, release, throwing callback, cancel) and CJS entry through the same runner. It is not a native supervisor, host loop, shutdown/fault owner or app runner.
16. `native/supervisor` is a MoonBit-native prototype that spawns the real AppKit/WKWebView host over inherited socketpairs and completes hello/ready/shutdown without Node. It now draws a random session, validates the app root, creates a window, drives `begin-load` and the load-channel `load-file` to `didFinishLoad`, reads an event-channel `isolated-preload-attested` notice, reads `package.json`, resolves its `main`, evaluates the linked-QuickJS fixture app main with a local CJS graph (relative paths, extensions, directory index, JSON, cache identity) and a node_modules package with `exports`, validates the native bootstrap status, applies its title to the native window, destroys the window and shuts down, then starts/stops a second host. Initial start/handshake retries up to three times with 100 ms backoff, and the flaky-wrapper probe reaches attempts=2. It passes dead-child/missing-root/entry-traversal/handshake-timeout probes; dead-child and timeout now report retry exhaustion as `START`. The loader is a C/JS fixture probe over a fixed source list; it is not `runtime/runner`, a general node_modules/exports resolver or a general app loader. It still has a fixed default root/test env overrides, no crash-after-ready restart/backoff or general event routing, no QuickJS ownership and no Moji app main boot.
17. `compatibility/adapted-preload-v1.json` and `fixtures/native-app/adapted/` define a generated page-world API fixture for the adapted profile. `install-adapted-adapter` injects a native host script and the pinned adapter at document start in `WKContentWorld.pageWorld`; per-document nonces report adapter installation before `LoadComplete` and bind a fixed-topic page dispatcher. The supervisor verifies `adapted-api-ok`, bounded queue timeout/overflow, a forged-page-nonce rejection, unknown-topic and stale-generation rejection, `doc:open` delivery after load, and delivery again after an explicit generation-2 reload. The page API has fixed local topics with synchronous idempotent disposers and ingress-gated Promise calls whose bounded first-call queue is unit-tested with a test host. Original preload execution, contextBridge/ipcRenderer, native application ingress/Main dispatch, production event routing and Moji adaptation remain unimplemented.
18. The adapted entry, generated adapter, package metadata and preloaded Main module graph are prepared as a private source snapshot. `fixtures/native-app/source-manifest.json` (schema 2) pins the 11 fixture files by relative path, SHA-256 and bytes; native `prepare-source` verifies the manifest, rejects absolute/`..`/symlink-escape/non-regular/duplicate/oversize entries and writes a `0700`/`0600` staging tree outside the app root. `load-file`, `install-adapted-adapter` and the supervisor QuickJS Main read the staged files, `get-document-identity` reports generation/source/entry hash/manifest hash after a completed current load, and the supervisor plus the `m1-source-snapshot` probe verify entry+adapter mutation isolation, hash-mismatch/symlink/non-regular/missing-manifest rejection, generation-2 snapshot reload and staging cleanup. A dynamically discovered graph, manifest signing, full Node symbol support, Main/IPC sender admission and origin/redirect policy remain open.
19. A page-world `electronMbtApp` handler admits `selftest:identity` and recognizes the adapted application operations. Native derives the sender from the actual `WKScriptMessage` frame/document/generation, ignores the payload's claimed sender, and rejects unknown operations, malformed requests and oversized payloads with typed counters; recognized app operations end in `NO_HANDLER`. The host exposes `whenReady`/`dispatch`, and `release-adapted-ingress` flushes the adapter queue: four calls reach native and reject `NO_HANDLER`, three overflow calls stay `QUEUE_FULL`. The supervisor verifies the sender identity, two denials and `nativeQueueUnhandled: 4` after load and after the generation-2 reload. Main/QuickJS dispatch, the production `DocumentIngressReady` transition, iframe/subframe handler policy and origin/redirect authority remain open; the srcdoc iframe could not reach the page-world handler in this WebKit, so that negative is NOT RUN.
20. The native supervisor retains a QuickJS Main fixture context after evaluating the CJS graph staged in the source snapshot. The loader reads the manifest file list (relative/package/JSON resolution), supports a bounded `node:path` subset, and fails closed for unsupported builtins. `app-request` events carry page operations to the supervisor; a C bridge calls `globalThis.__nativeInvoke`, and an `app-reply` control frame returns the JSON envelope to the native host's pending page reply. `getSettings`/`getUpdateState` now resolve with `{source:"quickjs-main"}` values instead of `NO_HANDLER`. The fixture scenario applies Main settings/state to the page and sets `nodeless-app-ready`, then observes a delivered `app:request-close` event as `nodeless-close-requested`; the generation-2 reload repeats both. The loader is still a preloaded manifest graph, Node symbol support is only `node:path`, close is event-only and Moji is not booted.
21. A Moji-shaped adapted API is generated from the pinned preload contract: 14 IPC calls, 3 events and a typed unsupported `getDroppedPath`; the original preload is `NOT_EXECUTED` and the adapter is `fixtures/moji-adapted/page-api.js`. Schema-3 generation supports declared arity and call-time argument-array snapshots. The native ingress prefix allowlist routes a Moji `settings:get` request into QuickJS Main, where `settings:get`/`settings:set`/`update:get-state`/`app:confirm-close` resolve through fixture handlers and `file:read-path` fails closed as unregistered (`mojiOperationRouted`, `mojiHandlers`). Moji main handlers, file/dialog/export services, main/preload boot and an app scenario remain unimplemented.
22. A partial native file broker handles `file:read-path`, `file:save`, `file:read-image` and `file:read-sample` with mode grants, app-root containment/symlink checks, 1 MiB read/image and 64 KiB save bounds, and atomic writes. `samples/*` is read-only without a grant; the grant source is the test-only `grant-file` control operation. The page reads a sample, saves/rereads a granted file, and is denied an ungranted write and a `..` escape; the supervisor reports `fileBroker`/`fileRead`/`fileSave`/`fileDenied`. NSOpenPanel/NSSavePanel, export, `openLocalPath` and Moji file handlers remain unimplemented.
23. Open/save dialogs have a partial adapted path: `file:open-dialog` and `file:save-as` use a test-only `set-dialog-result` to exercise read/readwrite grants and an atomic save, while compiled AppKit `NSOpenPanel`/`NSSavePanel` sheets provide the production path (UI NOT RUN). The page opens a sample, saves `saved-by-dialog` and reads it back; the supervisor reports `fileDialog`/`fileSaveAs`. Real dialog UI consent, export, `openLocalPath` and Moji file handlers remain unimplemented.
24. Partial export writes `doc:export` HTML (64 KiB) and `diagram:export-png` validated PNG (1 MiB) through test-injected save paths and compiled AppKit `NSSavePanel` code (UI NOT RUN). The page exports HTML, reads it back, exports a 1×1 PNG and reads it through `file:read-image`; the supervisor reports `exportHtml`/`exportPng`. PDF/PNG document rendering, real panel UI and Moji export handlers remain unimplemented.
25. Moji's pinned bundled main boots in QuickJS through `fixtures/moji-boot/harness.js`: it evaluates `out/main/main.js`, reaches `whenReady`, creates one virtual window, registers 14 IPC handlers and invokes settings/update/read-sample/confirm-close handlers (`moji-main-boot` PASS, `settings` dark→light→light). The boot graph includes the pinned preload, but the original preload is `NOT_EXECUTED`; the Electron/Node facade is virtual, no renderer/IPC message is involved, and `compatible:false` is unchanged.
26. A focused native E2E installs the generated Moji adapter in a probe page and routes `getSettings`/`getUpdateState` through native ingress to the QuickJS Moji `settings:get`/`update:get-state` handlers (`moji-adapted-native` PASS; page title `moji-adapted-ready:dark:unsupported`, `mainHandlers:true`). The original preload is NOT_EXECUTED and the real 13 MB renderer is not loaded; async file/dialog/export handlers return `ASYNC_PENDING` through the bridge.
27. The pinned Moji renderer (112 files, ~13 MB) loads in WKWebView under the adapted API and renders its real UI via a test-only loopback asset server (`moji-renderer` PASS; title `Moji v1.0.5`, root child present, `apiPresent:true`). The original preload is NOT_EXECUTED; async file/dialog/export handler dispatch, real dialog UI, PDF/PNG document export and production asset loading remain open. Source-snapshot bounds are now 16 MiB/file, 64 MiB total and 4096 files.
28. The real Moji renderer now exercises the native file broker from the adapted API: `save` writes a test-granted `renderer-save.md`, `readPath` reads it back, and `readSample("markdown-guide.en.md")` returns the real sample (`saveOk/readOk/sampleOk:true`). The broker returns Moji-shaped `ok`/`content` fields; dialogs/export/async Main dispatch remain.
29. The real Moji renderer also exercises open/save/export through the native broker with test-injected paths: `openDialog` returns the real sample document (`documents[0].content`), `saveAs` writes `renderer-save-as.md`, `exportAs` writes HTML and `exportDiagramPng` writes PNG (`openOk/saveAsOk/exportOk/pngOk:true`). The AppKit panel UI is still NOT RUN; PDF/PNG document rendering and async Main dispatch remain.
30. The real renderer also exports a PDF document: `exportAs({format:'pdf', html})` renders the HTML in an offscreen WKWebView (`createPDF`) and writes a validated `%PDF` file to the test path (`pdfOk:true`). HTML, PDF and diagram PNG export pass; PNG document rendering, page-size/orientation fidelity, the real panel UI and async Main dispatch remain open.
31. The real renderer also exports PNG documents: `exportAs({format:'png', html})` snapshots an offscreen WKWebView into a PNG file (`docPngOk:true`). HTML, PDF and PNG document export plus diagram PNG pass; page size/orientation fidelity, print-accurate multi-page output, the real panel UI and async Main dispatch remain open.
32. Async Main dispatch now settles microtask-resolving Moji handlers: the harness records a pending JSON result, the C bridge drains QuickJS jobs and returns it. The real renderer's `checkForUpdate()` receives `{status:"unsupported"}` (`updateCheckOk:true`). Timers/native completion promises, cancellation and per-handler deadlines remain open.
33. The pinned preload is evaluated virtually in the QuickJS harness with stub `contextBridge`/`ipcRenderer`/`webUtils`; it exposes `api` with 18 methods matching the adapted API (`preloadVirtualExecuted:true`, `preloadMethods:18`). It remains NOT_EXECUTED in WebKit and the M0 contextBridge gate is unresolved.
34. PDF/PNG document export now honors Moji's `pageSize` (A4/Letter/Legal) and `pageOrientation` (portrait/landscape) for the offscreen page rect; a Letter-landscape PDF is exercised (`pdfLandscapeOk:true`). Multi-page/print-accurate rendering and `assetBaseUrl` remain open.
35. A native dialog UI smoke opens the real `NSOpenPanel` as a sheet and programmatically cancels it (`panelOpened/panelCompleted/panelCanceled:true`, `selection:false`). Readiness `adapted-dialog-ui` is PASS for open/cancel; file selection, save panel UI, user consent and grant persistence remain open.
36. The B5 repaired-primitive contextBridge spike is implemented as a test-only native probe (`scripts/m0-context-bridge-probe.cjs`, `platform/macos/M0ContextBridgeProbe.m`, `fixtures/worlds/m0-cb-*`). It installs a page shim and a named isolated-world shim at document start, runs the **unchanged** `fixtures/oracle/preload.cjs` through a test-only CommonJS wrapper, and uses synchronous shared-DOM `dispatchEvent` with a per-probe HMAC-SHA-256 secret, per-document session ID and native document grant. On macOS 26.5.2 / WebKit `21624.2.5.11.8`, checkpoint 1 (first-script sync return/throw, forged replies not accepted, secret not observable) and checkpoint 2 (callbacks, nested/reentrant calls, Promise, frozen copies, isolated primordials, sandboxed child denial, reload and stale-grant rejection) passed; the unchanged oracle observation matched the pinned validator on both documents, with source hashes preserved. Decision: **go for B6 planning**, not M0 closure. The Electron baseline differential is NOT RUN locally (no pinned Electron install) and runs in CI after baseline collection. The original preload remains NOT_EXECUTED; production `contextBridge`/`ipcRenderer`, MoonBit authority/lifetime/bounds, native sender/document authority and an independent security review remain open. `compatible:false`, M0 OPEN and strict blocked are unchanged. See [docs/0038](0038-m0-context-bridge-spike.md).

37. B6-A adds the production exposure-authority contract to MoonBit. `Runtime` now owns bounded `BridgeExposure` records (API key, descriptor bytes/function count, 64-hex descriptor SHA-256), a monotonic exposure ID, 32-per-document / 128-per-runtime quotas, duplicate-key denial, idempotent release, and revoke-on-stop/destroy/navigate/invalidate alongside bridge handles. The private `context_bridge_dispatch` accepts only exact flat `expose` / `release-exposure` host metadata; it creates no page API and is not a renderer endpoint. Tests: `moon test --target js` 141, `--target native` 160, `node --test tests/context-bridge-exposure.test.cjs` 4, full `npm test` 447 pass. This is B6-A policy/contract work, not a transport, preload loader, native-host integration, security review or M0 closure; the strict profile remains blocked and the original preload remains NOT_EXECUTED. Design/scope: [docs/0039](0039-b6-strict-context-bridge.md).

38. B6-B adds an opt-in experimental preload bridge environment (`ELECTRON_MBT_B6_PRELOAD_BRIDGE=1`) without changing the default restricted preload. In this mode the isolated preload's `require('electron')` returns a bounded `contextBridge.exposeInMainWorld` that records function handles/arities and copied plain data; `ipcRenderer`/`webUtils` remain fail-closed. The native host validates the exposure descriptor and publishes a `preload-exposure` event only after the independent bootstrap/preload attestation; the transport protocol validates the exact metadata; `ExperimentalRuntime` registers the exposure through the MoonBit B6-A authority using the trusted bootstrap scope. The descriptor body stays in the native host; the page API is not materialized. The unchanged oracle preload bytes (same SHA-256) produce `preload status=ok`, one exposure event, MoonBit registration and same-url reload revocation, with the page seeing no `window.fixture` and no native handlers; source hashes are preserved. The default restricted preload, `contextBridge:NOT_IMPLEMENTED`, strict blocked, M0 OPEN and original-preload NOT_EXECUTED are unchanged. Remaining B6-B: ipcRenderer invoke/on/removeListener, webUtils, Node-free preload globals/modules and arbitrary source; B6-C transport/page shim/native authority remain. Tests: Moon JS 142, native 161, npm 448; [docs/0039](0039-b6-strict-context-bridge.md).

39. B6-C adds an opt-in experimental synchronous contextBridge transport in the M1 host. The trusted Node runtime reads host-owned sources (`bridges/preload/{codec,page-shim,isolated-bridge}.js`) and passes them with SHA-256 through the `install-preload-bridge` control op; the native host re-verifies, injects the page shim in `pageWorld` and the isolated bridge + unchanged CJS preload wrapper in the preload world at document start, and generates a per-document secret and document grant. The isolated bridge's document handler returns the grant only to the preload main frame; its bounded report lane validates the actual frame/URL/generation/grant and emits `preload-report` (test evidence only). The transport protocol accepts only exact install/report shapes. The unchanged oracle preload and page run to the pinned observation: first-script sync `42`/throw, Promise `43`/rejection, callbacks, frozen copies, primordial isolation, exposure registration, same-url reload and revocation, source hashes and no page-visible native handlers; the default preload and B6-B paths still pass. Strict remains blocked because the MoonBit exposure registration is not yet part of page admission, the shared-DOM/HMAC transport lacks independent review, full preload globals/ipcRenderer/webUtils/frame policy/value semantics remain open, and the report lane is test-only evidence. Tests: Moon JS 143, native 162, npm 449; [docs/0039](0039-b6-strict-context-bridge.md).

40. B6-D/B6-E: the B6-D semantics matrix drives the experimental production transport through primitives/null/arrays/plain objects, undefined return, returned functions, thrown/returned errors, frozen data, primordial isolation, 15 unsupported arguments and 13 unsupported returns, callback identity/disposers/nested/reentrant/throw/Promise callbacks, Promise fulfillment/rejection/unsupported settlement/thenables/double settlement, and a same-url reload. It found and fixed three defects: symbol-keyed properties silently dropped, sparse arrays silently converted to undefined, and a synchronous-thenable settlement race before the page registered the promise handle (bounded early-settlement buffer). B6-E adds an unchanged-oracle baseline comparison (`evidence/electron-baseline.json`, required in the macOS CI evidence step), evidence commands, exact local PASS/NOT RUN status, a security-review packet and residual-risk/checklist documentation. Strict remains blocked: page admission still precedes MoonBit exposure registration, the custom HMAC/shared-DOM transport has no independent review, the candidate page shim materializes only the `fixture` key, and full preload globals/ipcRenderer/webUtils/frame policy/page self-DoS/fault injection remain open. Tests: Moon JS 143, native 162, npm 450; local B6-C baseline comparison NOT RUN (no Electron baseline); independent review NOT RUN; [docs/0040](0040-b6-d-e-evidence.md).

41. 2026-10-18 reviewer decision: the project owner accepted the B6-C/B6-D experimental transport candidate for B7 design work after reviewing [docs/0040](0040-b6-d-e-evidence.md). The acceptance covers the transport, the B6-D semantics matrix, the source-integrity/control-channel design and the review packet; it is not a strict-profile admission, a compatibility result or an external independent audit. The residual risks remain tracked: page-admission ordering, arbitrary API keys, the custom HMAC/shared-DOM transport, full preload globals/ipcRenderer/webUtils, frame policy, page self-DoS and fault injection. The strict profile remains blocked; no acceptance row is promoted. B7 must close the runtime/security gates and provide the strict-profile evidence before any change to `compatible`, the original preload or the strict gate.

42. B7 strict-profile admission work started after the project-owner acceptance of the B6-C/B6-D transport. The strict profile (`electron-nodeless-v1`) remains planned/blocked; the accepted transport still runs only in the Node-backed experimental M1 host. Three arbitrary-API-key experiments (document-start `<meta>`, document-comment + microtask, window-prototype Proxy) were attempted and reverted: the page shim did not obtain the key before the first page script (and WebKit rejects both window and `Window.prototype` prototype replacement), so the B6-C/B6-D tests timed out; arbitrary keys are an architectural limit of the shared-DOM/lazy page shim. Open B7 gates: page-admission ordering (MoonBit registration after page materialization), arbitrary keys, full preload environment, frame/self-DoS/fault policy, strict runtime implementation/evidence and the profile decision. The B7 plan and findings are in [docs/0041](0041-b7-strict-profile-admission.md). Strict remains blocked, compatible:false, M0 OPEN and the original preload NOT_EXECUTED.

43. B7 arbitrary-key prerequisite: the experimental M1 transport now previews the unchanged preload in a disposable Node VM with a `contextBridge` facade before navigation, discovers exactly one exposed key, passes it through `install-preload-bridge`, and injects it into the host-owned page shim before the first page script. The real WKWebView preload runs unchanged and the signed descriptor must match the preview key. Evidence: `tests/context-bridge-preload-key.test.cjs` (oracle `fixture`, edge `edge`, custom/reserved/missing/multiple/unsupported/failing), B6-C/B6-D E2E with both keys, npm 452, default and B6-B paths green. Limits: single deterministic key, VM preview stubs/double execution, strict nodeless QuickJS port still required, and page-admission ordering (page API before MoonBit exposure registration) remains open. Strict profile blocked; no compatibility change.

44. B7 page-admission pre-registration: the preload preview now also encodes the production descriptor in the VM; the runtime pre-registers the exposure with the MoonBit B6-A authority (activate/grant/expose) before `load-file`; the actual WKWebView descriptor event must match the preview's key/bytes/function count/SHA or the runtime aborts. B6-C/B6-D pass with the pre-registration; `tests/context-bridge-admission-native.test.cjs` uses a process-dependent preload (preview-key vs actual-key) and verifies the mismatch abort (host dead). Limits: the preview is not the actual descriptor; the page's first script can run before the Node's actual comparison; a same-key descriptor-only mismatch is detected after the page; the strict runtime needs a host-side actual-before-page admission token and the strict nodeless port; full preload/frame/self-DoS/evidence remain. npm 453. Strict blocked; no compatibility change.

45. B7 host-side actual descriptor verification: `install-preload-bridge` now carries the preview exposure metadata (apiKey, descriptor bytes, function count, SHA-256); the native host compares the real WKWebView descriptor and replies ok/no while still publishing the actual exposure so the Node pre-registration comparison can abort a mismatch. The mismatch test remains fail-closed; B6-C/B6-D pass. Gating the isolated hello/page on the host reply was attempted and reverted: the reply is asynchronous and the first page script lost the API (both B6-C/B6-D timed out). The host verification is post-hoc; the actual-before-page gate needs a synchronous pre-page admission or the strict nodeless runtime, which remains open. npm 453; strict blocked; no compatibility change.

46. B7 frame policy characterization: the experimental M1 host cancels every subframe navigation (main-frame-only). `tests/context-bridge-frames-native.test.cjs` verifies a same-origin child and a sandboxed `allow-scripts` child are both absent, the parent API still works, and the parent page cannot see the preload/native transport handlers. This is stricter than Electron (which can host child frames) and is therefore not an Electron-compatible frame policy; the child-frame compatibility decision, page self-DoS and the fault-injection matrix remain open. npm 454. Strict blocked; no compatibility change.

47. B7 page self-DoS evidence: `tests/context-bridge-self-dos-native.test.cjs` loads a page whose first script busy-loops forever. After 500 ms the load is still in flight, but the native `get-web-contents-title` and `get-preload-status` requests both answer (preload status `ok`; the title is empty because the page never finishes parsing). The native control lane is therefore not blocked by page JavaScript. This is one bounded observation; CPU/memory exhaustion and the full fault-injection matrix remain open. npm 455. Strict blocked; no compatibility change.

48. Node-less main runtime increment: `native/nodeless` is a Node-free CLI that admits a pinned `source-manifest.json` (native SHA-256), builds a CJS graph in MoonBit (relative/JSON/package `exports`/nested `node_modules`; cache/cycles), and evaluates it on QuickJS with a bounded Node/Electron prelude. The fixture `fixtures/nodeless-app` passes: `path`, `url` file helpers, `process`, `EventEmitter`, `Buffer`, `electron.app`/`ipcMain`, nextTick→jobs→timers, async handler settle, and a host-required `fs` failure (`ELECTRON_MBT_HOST_UNAVAILABLE`) because that fixture runs without `--window`. A fake `node` on `PATH` plus `otool`/`nm` audits show no Node process or Node-API link. Limits: no preload, real renderer or real file/update/zlib behavior; strict remains blocked, and ASAN/ownership/external review are NOT RUN. Tests: Moon JS 145, native 176, npm 461; [docs/0042](0042-nodeless-main-runtime.md). `compatible:false`; no compatibility row.

49. G-2/G-3 partial: `native/nodeless --window` starts the real AppKit/WKWebView host over inherited socketpairs, installs a synchronous C host bridge into QuickJS, and supports a bounded `BrowserWindow` (`create-window`, `loadFile` via `prepare-source`/`begin-load`/`load-file`, get/set title, webContents title/URL, destroy). `fixtures/nodeless-window-app` loads a page and reports `pageTitle:"nodeless-window-ready"`, `hostShutdown:true`, `liveLeases:0`. `scripts/nodeless-moji-boot.cjs` verifies the pinned Moji main/preload hashes and boots the real bundled main against a probe page (`mainEvaluated:true`, `pageTitle:"moji-nodeless-ready"`, `preloadExecuted:false`, `rendererLoaded:false`). `fs`/`fs.promises` are now host-backed in `--window` mode for app-root reads and `.appData`/`.userData` atomic writes; main user-file grants, `zlib`, and `electron-updater` remain adapted/import-only behaviors, not Node/Electron parity. Open: full BrowserWindow/webContents events, main user-file grants, zlib stream, updater behavior, original preload/contextBridge, full app scenario and strict profile. Tests: npm 469; [docs/0043](0043-nodeless-window-and-moji-main-boot.md). `compatible:false`.

50. Node-less adapted renderer boot: `native/nodeless --window` now loads the renderer from a hash-verified snapshot through a snapshot-scoped `electron-mbt-app://app/...` `WKURLSchemeHandler`, installs a manifest-listed generated page adapter at document start, and pumps page `app-request` events into QuickJS `ipcMain` handlers with bounded `app-reply`. `fixtures/nodeless-adapted-app` proves ES-module execution, custom-scheme origin, entry-directory asset denial, `localStorage` observation and two page API calls through main. `scripts/nodeless-moji-app.cjs` boots the pinned Moji real renderer (113 admitted files): `pageURL:"electron-mbt-app://app/out/renderer/index.html"`, title `Moji v1.0.5`, real UI text, `rootChildren:1`, `apiPresent:true`, adapted requests 2 with 0 failures, `preloadExecuted:false`, `liveLeases:0`, `nodeProcesses:0`. `SourceSnapshot` admits binary renderer assets without treating them as JS source. Limits: original preload NOT_EXECUTED, strict blocked, no real file/dialog/export/update/zlib behavior, custom-scheme `localStorage` was unavailable in the pinned Moji run and inconsistent in the fixture, human app scenario NOT RUN, ASAN/ownership/external review NOT RUN. Tests: `node --test tests/nodeless-runtime.test.cjs` 10 PASS, Moon JS 145, native 177, npm 465; [docs/0044](0044-nodeless-adapted-app-renderer.md). `compatible:false`; no compatibility row.

51. Node-less broker E2E (test-injected): `native/nodeless --broker-selftest` applies a manifest-listed `nodeless-broker.json` through the existing native `grant-file`/`set-dialog-result` controls, triggers the real Moji renderer `window.api` file paths, pumps main events while the probe is pending, and verifies the page `apiProbe` plus written outputs. Observed: 1 grant, 6 dialogs, `save`/`readPath`/`readSample`/`saveAs`/HTML/PDF/PNG document/diagram PNG export all pass, `setSettings({language:"ja"})` persists `.appData/moji/settings.json` (`settingsPersisted:true`), `checkForUpdate` returns unsupported, and the temp files match expected content/magic. `--broker-selftest` is required; a broker file alone is ignored (negative test). Production consent, human open/save panel flow, grant persistence, print-accurate export, real updater/zlib behavior and original preload remain open. Tests: nodeless 14 PASS, npm 469; [docs/0045](0045-nodeless-broker-e2e.md). `compatible:false`.

52. Node-less main-side fs: `--window` installs the private host bridge before main evaluation, and the prelude now exposes host-backed `fs.existsSync`, `fs.readFileSync`, `fs.writeFileSync`, `fs.promises.readFile` and `fs.promises.writeFile`. Reads are confined to the canonical app root; writes are confined to `.appData`/`.userData` with a 256 KiB read/write bound and Cocoa atomic replace. Relative paths resolve from the app root; `realpath`-based canonicalization denies traversal and symlink escapes. Missing parent directories under a write root are created with `0700`. The new `fixtures/nodeless-fs-app --fs-selftest` covers UTF-8/Buffer/base64, sync/async reads and writes, a 200,000-byte round-trip, nested appData creation, empty files, `EACCES` denials, `ENOENT`, `EFBIG`, unsupported flags and a symlink-escape negative. Moji settings now persist and are independently inspected. The prelude host response buffer is 1 MiB so bounded base64 reads are not truncated. Limits: main user-file grants outside the app root, directory/stream APIs, callback `readFile`, true thread-pool async I/O, metadata preservation and TOCTOU hardening remain open; a non-window run fails with `ELECTRON_MBT_HOST_UNAVAILABLE`. Tests: nodeless 14 PASS, Moon JS 145, native 177, npm 469; [docs/0046](0046-nodeless-main-fs.md). `compatible:false`.

53. Node-less main user-file grants: the host now keeps a session-scoped registry of exact user files, populated by native open/save/export panel completion or the explicit `nodeless-user-file.json` `--user-file-selftest` scenario. Main can read/write granted paths outside the app root while ungranted paths stay `EACCES`/`false`. Grants are canonicalized, limited to 64 distinct paths, merge read/write bits, require an existing parent for new write targets and are never persisted. The QuickJS host bridge now uses an explicit operation allowlist, so app code cannot call `grant-main-file`, `grant-file`, renderer probes, ingress release or `app-reply`; those return `ELECTRON_MBT_HOST_REQUEST_DENIED`. `fixtures/nodeless-user-file-app` verifies sync/Promise reads, granted writes, denied read/write/exists, and blocked self-grants. Limits at that increment: no persistence/revocation, no directory grants (added in item 55), human panel consent NOT RUN, 256 KiB bound, atomic-replace adaptation and TOCTOU remain. Tests: nodeless 16 PASS, Moon JS 145, native 177, npm 471; [docs/0047](0047-nodeless-user-file-grants.md). `compatible:false`.

54. Node-less directory and metadata fs: `--window` main now exposes host-backed `fs.statSync`, `fs.readdirSync`, `fs.mkdirSync` and `fs.promises.stat`/`readdir`/`mkdir`. `main-stat` adds `mtimeMs`; `main-read-dir` performs a bounded shallow `opendir`/`lstat` listing (4,096 entries, 512 KiB of names, symlinks classified and not followed); `main-mkdir` creates one component or a bounded recursive chain (64 new components) under `.appData`/`.userData` with `0700`, mapping `ENOTDIR`/`EEXIST`/`ENOENT`/`EFBIG`/`EACCES`. Exact user-file grants allow stat of the granted file but not parent listing or mkdir next to it. `Stats`/`Dirent` are explicitly partial; `readdir` order is host order, explicit `mode`/`bigint`/`recursive` options fail closed, and recursive mkdir is not atomic. `fixtures/nodeless-fs-app` verifies file/directory stats, Dirent file/directory/symlink predicates, listings, mkdir idempotence/exists/missing-parent, denied/traversal cases, Promise variants, and symlink-escape listing/stat; a generated test verifies `EACCES` for recursive escape and `EFBIG` for 4,097 entries / 65 components. Limits at that increment: directory grants, streams/lstat/rm, full Node Stats/Dirent, persistence and TOCTOU hardening remained open; directory grants were added in item 55. Non-window use fails with `ELECTRON_MBT_HOST_UNAVAILABLE`. Tests: nodeless 17 PASS, Moon JS 145, native 177, npm 472; [docs/0048](0048-nodeless-directory-fs.md). `compatible:false`.

55. Node-less main directory grants: `--window` main now accepts a session-scoped `grant-main-directory` control for an existing canonical directory with read, write or readwrite bits. The grant authorizes the existing bounded `stat`, `readdir`, `readFile`, `writeFile` and `mkdir` host calls inside that subtree; read-only, write-only and readwrite behavior stay distinct, exact-file grants do not imply directories, and `grant-main-file` still rejects directories. The registry is CLI-only (`native/nodeless/host_client.c` keeps it outside the JavaScript allowlist), caps at 16 distinct directories, rejects `/`, canonicalizes with `realpath`, and merges duplicate bits. A prefix sibling (`grant-evil`), escaping symlink, `..` traversal, missing write parent and the existing 4,096-entry/512 KiB listing, 256 KiB read/write and 64-component mkdir bounds are verified. `fixtures/nodeless-directory-app` plus generated scenarios cover read/readwrite/write-only grants, denied paths, symlink escapes and hostile app-code grant attempts. Grants are applied by the explicit `--directory-selftest` scenario after main load and before dispatch; they do not persist and there is no native directory picker or production consent path. Tests: nodeless 20 PASS, Moon JS 145, native 177, npm 475; [docs/0049](0049-nodeless-directory-grants.md). `compatible:false`, no acceptance row.

56. Node-less main open dialog: `--window` main now exposes `dialog.showOpenDialog(options)` and `dialog.showOpenDialog(parent, options)` in the QuickJS realm. The prelude validates bounded options (`properties`, `filters`, `defaultPath`, `title`, `buttonLabel`), rejects unknown keys, and rejects `showOpenDialogSync`/save/message APIs. The native host opens a real `NSOpenPanel` (app-modal, not sheet-attached) and turns the selected canonical files/directories into session read grants; test-injected results exercise multi-select, mixed file/directory, cancel, type mismatch, duplicate paths, 16-path success, 17-path `EFBIG`, unsupported options, destroyed parents and hostile control calls. Grants are applied atomically (no partial authority), are read-only, and never persist. `fixtures/nodeless-dialog-app` plus `scripts/nodeless-dialog-ui.cjs` cover the contract and a test-only auto-cancel host build that records real panel open/cancel (`selection:false`). The Promise is provided but the private host call blocks the QuickJS main until the panel closes; human selection, write consent, sheet-modal parenting, persistence and revocation remain open. Tests: nodeless 23 PASS, Moon JS 145, native 178, npm 478; [docs/0050](0050-nodeless-main-dialog.md). `compatible:false`, no acceptance row.

57. Node-less main save dialog and write consent: `--window` main now exposes `dialog.showSaveDialog(options)` and `dialog.showSaveDialog(parent, options)` in the QuickJS realm. The prelude validates bounded `defaultPath` (absolute path or bare file name), `filters`, `properties` (only `showOverwriteConfirmation`) and `title`/`buttonLabel`, and rejects unknown keys, unsupported properties and `showSaveDialogSync`. The native host opens an app-modal `NSSavePanel`; the selected canonical path becomes a session-scoped exact-file **readwrite** grant. Cancel, directories, special files, dangling symlinks, missing parents and a full 64-file registry fail closed without a partial grant; duplicate selections merge bits. Test-injected results cover new-file write/read/stat/rewrite, existing overwrite, sibling and parent-operation denials, the 64-file `EFBIG` cap, the filesystem root, destroyed parent and hostile control denial; `scripts/nodeless-dialog-ui.cjs` records a test-only `NSOpenPanel`+`NSSavePanel` open/cancel in one session (`selection:false`, `saveSelection:false`). The Promise is provided but the private host call blocks QuickJS main; human save selection, overwrite confirmation, extension appending, sheet-modal parenting, persistence and revocation remain open. Tests: nodeless 26 PASS, Moon JS 145, native 178, npm 481; [docs/0051](0051-nodeless-main-save-dialog.md). `compatible:false`, no acceptance row.

58. B7 admitted-descriptor page binding: the experimental M1 page shim now receives the preview descriptor metadata (bytes, function count, SHA-256) lexically and the isolated bridge includes the actual descriptor metadata in its signed handshake. `hello()` checks all three synchronously before decoding/materializing; a same-key descriptor mismatch throws `ELECTRON_MBT_BRIDGE_ADMISSION_MISMATCH`, so the page cannot use an API MoonBit did not admit. The native expected-descriptor check and Node pre-registration comparison remain as defence in depth. The fixture keeps the `fixture` key but exposes one function in the VM preview and two in WebKit; the page records `admission:blocked:...`, MoonBit holds only the preview exposure, and the default mismatch path still aborts. `ELECTRON_MBT_B6_ADMISSION_OBSERVE=1` is test-only for reading the page-side result. This closes the same-key page-materialization gap for deterministic descriptors; dynamic/non-deterministic preloads now fail closed, the hidden-preflight/double-execution design was not implemented, and the strict nodeless port/full preload/frames/fault matrix/independent review remain open. Tests: admission-binding 1 PASS, B6/B7 suite 7 PASS, npm 482; [docs/0052](0052-b7-admission-binding.md). `compatible:false`, no acceptance row.

59. Node-less document identity and reload authority: `host_client.c` now owns the single Node-less window/generation, advances it on each `begin-load`, uses it for every control frame and exports it via `moonbit_ebt_nodeless_host_identity`. The MoonBit pump rejects `app-request` events whose window/generation differ from the current identity before Main dispatch; the report records `documentGeneration` and `adapted.rejected`. `prepare-source` can stage a reload after a completed load, `install-adapted-adapter` refreshes the source and installs its handlers once, and plain/adapted apps now reach generation 2. A test-only `inject-app-request` + `--ingress-selftest` (gated by `ELECTRON_MBT_TEST_MODE=1`) shows one stale event rejected and one current event handled; the current event also carries forged window/generation/sender/origin claims, which are ignored. A malformed main-frame page message is denied at the native ingress and an iframe/srcdoc attempt cannot reach Main. The injection operation is not in the QuickJS app allowlist. The adapter ingress is now released automatically when the load completes; the explicit release control remains test-only. Limits: single window and a dedicated subframe-handler rejection proof remain. Tests: nodeless 30 PASS, npm 486, Moon JS 145, native 178; [docs/0053](0053-nodeless-document-identity.md). `compatible:false`, no acceptance row.

60. Main grant persistence and revocation: the native host stores canonical file/directory grants at `<app>/.userData/electron-mbt/grants-v1.json` (schema 1, 0600, atomic write, 256 KiB read bound, 64/16 caps) and loads them before windows. Stored paths must equal `realpath`; malformed JSON, schema mismatch, non-regular targets or non-canonical symlink paths reject the whole store. `grant-main-file`/`grant-main-directory`, native open/save selections and revocation rewrite the store. New CLI-only `get-main-grant-store` and `revoke-main-grant` controls are not in the app allowlist. `--grant-persist-selftest` proves a second process loads the grants and the app reads/writes without re-granting; `--grant-revoke-selftest` proves the store empties and `main-read-file`/`main-write-file` are denied; the next persist run fails closed. A deterministic fixture also reads and saves the same document after a process restart using the persisted readwrite grant. Tests: nodeless 33 PASS, npm 489, Moon JS 145, native 178; [docs/0054](0054-grant-persistence-and-revocation.md). `compatible:false`, no acceptance row.

61. Moji open-for-edit edit/save/restart: the adapted renderer open now issues an exact-file **readwrite** broker grant (read + replace-selected) after validating and reading the selected regular file, then applies the narrower main `read` grant; a failed main grant restores the broker bits. The grant is app-session scoped (the existing supervisor reload fixture relies on that lifetime); document-scoped revocation is not implemented. `file:save` now counts `fileSaveAdmitted`/`fileSaveDenied`, exposed through `get-ingress-status`. A CLI-only, test-mode-gated `trigger-renderer-edit-save` drives the pinned Moji renderer's own Open/Editor/Save controls; `document.execCommand('insertText')` is the primary synthetic edit and the app's replace panel is the fallback. `--moji-edit-save-selftest` and `--moji-reopen-selftest` use zero injected grants and one test-injected open dialog, then verify Phase 1 (edit + normal save) and Phase 2 (restart, re-open, first marker visible, re-edit + re-save) with exact UTF-8 bytes. The first save inserts before the final line break, so the harness compares the deterministic 47→74→103 byte document. `file:save`/save-as now use `atomic-replace-v1`: mode 0640 and the test xattr survive both saves, a hardlinked document is denied with `ELECTRON_MBT_FILE_LINK`, and the third phase confirms both links keep the same 103 bytes. Owner/ACL, fsync/rename fault injection and a hostile-writer CAS remain open. `scripts/nodeless-moji-edit-save.cjs` reports `mode:"test-injected"`, `humanInput:false`, `preloadExecuted:false`, `compatible:false`. Tests: nodeless 34 PASS, npm 492, Moon JS 145, native 178, readiness 35 checks / 28 PASS / 2 FAIL / 5 NOT RUN; [docs/0055](0055-moji-edit-save-restart.md). Human picker/IME, owner/ACL, fsync/rename fault injection, hostile-writer TOCTOU, document-scoped revocation and strict profile remain NOT RUN. `compatible:false`, no acceptance row.

62. Public WKWebView sync contextBridge design and frame/origin PoC: the B5 test-only probe now loads a main frame and two children from one loopback-HTTP origin and records the page shim's scope. A same-origin child has no shim of its own (`ownApiType:"undefined"`), reaches the parent's page-world API through `parent`, calls `syncValue()` synchronously and receives `42`, and catches `syncThrow()` as `Error`; the Error is a parent-realm object (`childRealmError:false`, `parentRealmError:true`). An opaque sandboxed child is denied `parent.fixture` access and cannot see the native handlers. The native report lane still sees only the parent document; no child report reached it. The frame observation is complete and `hypothesisSupported:true`; B5 checkpoint 1/2 and `decision:go` are unchanged. This is test-only page-shim evidence, not production child-frame support; the production host remains main-frame-only and Electron child-frame/child-realm Error parity remain open. Tests: B5 evidence 17 PASS, npm 492, Moon JS 145, native 178, `verify-state` 19/19 checks with overall `NOT_READY`; Electron baseline differential, independent review and non-macOS execution NOT RUN. `compatible:false`, strict BLOCKED, original preload NOT_EXECUTED; [docs/0056](0056-sync-contextbridge-public-wkwebview.md).

63. Experimental Linux GTK/WebKitGTK native host: `platform/linux/NativeHost.c` and `platform/linux/control_frame.c` now speak the same private fd 3/4/5 frame protocol as the macOS host for the plain and adapted Node-less fixture path. Supported controls are `hello`/`ready`/`shutdown`, `create-window` without preload, `prepare-source` (schema-2 manifest, SHA-256/bytes verification, 0700/0600 staged snapshot), `install-adapted-adapter`, `begin-load`, `load-app-file` (`electron-mbt-app://app/...`), `load-file`, title/URL reads, the fixed `probe-renderer`, `get-adapted-status`, `get-document-identity`, `get-ingress-status`, `app-reply`, test-only `inject-app-request`, and `destroy-window`. Unknown operations and preload/contextBridge/file/dialog/export/menu/IME/close paths fail closed with typed errors. The page shim is top-frame/document-start, carries a per-document nonce and the host stamps window/generation; WebKitGTK's UI-process API does not expose `WKScriptMessage.frameInfo.isMainFrame`, so **native main-frame sender/frame authority is NOT PROVEN** and child-frame parity is not claimed. The snapshot scheme serves only the entry directory, so the fixture's `../src/main.js` fetch is denied. Pending replies (128) and events (1024) are bounded; a full event queue rejects with `ELECTRON_MBT_MAIN_BUSY` rather than dropping a request. One implementation finding: a private `JSCContext` created before the first `WebKitWebView` stalled page loading on WebKitGTK 2.52.6; the host now creates it after the WebView and uses a manual reply serializer for the pre-window `hello`/`ready` frames. `scripts/build-linux-host.cjs` builds `dist/electron-mbt-native-host-linux`; `native/nodeless/host_client.c` selects the Linux binary and keeps the `dist/`-only test override. `tests/nodeless-runtime.test.cjs` runs five shared tests on Linux when the host exists: plain load/title, plain reload generation, adapted module/page API, adapted reload/fresh ingress, and the stale-generation ingress selftest. Local Linux results (Ubuntu 24.04, GTK 3.24.41, WebKitGTK 4.1 2.52.6, X11, Node 24.22.0, MoonBit 0.1.20261016 — not the pinned CI versions): host build PASS; canonical-frame test 1 PASS; `node --test tests/nodeless-runtime.test.cjs` 14 PASS / 0 FAIL / 20 SKIP (all five shared tests PASS); `npm test` 493 tests / 462 PASS / 0 FAIL / 31 SKIP; Moon JS 145 PASS; Moon native 178 PASS. The CI `linux-native` job builds the host and runs the shared suite under Xvfb + dbus. PR #15 head `63274cf` passed `linux-native` (1m14s), `moonbit` (1m21s) and `macos` (4m16s) in [run 39541356486](https://github.com/f4ah6o/electron.mbt/actions/runs/39541356486); the macOS job exercises the existing macOS host, not this Linux host. readiness/G0–G4 are unchanged (`NOT_READY`, 35 checks / 28 PASS / 2 FAIL / 5 NOT RUN) and this slice adds no readiness check. `compatible:false`, strict BLOCKED, original preload NOT_EXECUTED, no acceptance row; [docs/0057](0057-linux-native-host.md).

64. Real Moji boot on the experimental Linux host: `scripts/nodeless-moji-linux.cjs` stages the pinned Moji v1.0.5 main/preload/renderer with the generated adapted page API and a schema-2 source manifest, verifies the recorded main/preload/adapter hashes, runs the real `out/main/main.js` through `native/nodeless` on the Linux GTK/WebKitGTK host, and writes `compatibility/reports/moji-linux-boot.json`. The real main and Vite renderer boot; the observed report is `status:PASS` (boot only), `pageTitle:"Moji v1.0.5"`, `pageURL:"electron-mbt-app://app/out/renderer/index.html"`, `rendererLoaded:true`, adapted observed/released with 2 requests/0 reply errors, ingress 2 admitted/0 denied, `mainError:""`, host shutdown true, 0 live leases/0 Node processes, `preloadExecuted:false`, `broker:"NOT_IMPLEMENTED"`, `compatible:false`. A screenshot of the initial UI is at [docs/0058](0058-moji-linux-boot.md) / `docs/images/moji-linux-20261021.png`. Tests: `tests/moji-linux-boot.test.cjs` (runs only when the pinned source and Linux host are present; otherwise skipped), `npm test` with the source present 494 tests / 463 PASS / 0 FAIL / 31 SKIP; the shared Linux 5 tests remain PASS. Limits: file broker/main fs/dialogs/export/grant persistence/updater behavior, human Open/Save/Export/IME/restart and native frame authority are NOT RUN or NOT IMPLEMENTED; the GTK window title is empty because the host does not propagate the WebView title. This Moji boot is **not run in CI** (pinned source is not fetched there) and macOS is **NOT RUN for this Linux result**. `compatible:false`, strict BLOCKED, original preload NOT_EXECUTED, no acceptance row; [docs/0058](0058-moji-linux-boot.md).

65. Explicit native window hold mode: `native/nodeless run <app> --window --hold [--hold-seconds 1..3600]` keeps the real window open after the app boots. The loop waits for the page title and, for adapted apps, the released adapter; prints a `HOLDING` JSON line with pageTitle/pageURL/hostPid/holdSeconds and `compatible:false`; pumps app-request/app-reply events; and prints `HOLD_EXIT` on a controlled exit. `--hold` requires `--window` and is mutually exclusive with the selftest flags; this is an interactive diagnostic, not a compatibility result. The new `the native window can stay open in explicit hold mode` test runs the adapted fixture for two seconds (15 PASS / 20 SKIP in `tests/nodeless-runtime.test.cjs` with the Linux host). The pinned Moji window stayed open at `Moji v1.0.5` with the initial UI visible; file broker/main fs/dialogs/export, human actions and native close/quit remain NOT RUN or NOT IMPLEMENTED, so the process must be terminated to end a hold. Full `npm test` with the pinned Moji source and Linux host: 495 tests / 464 PASS / 0 FAIL / 31 SKIP. No readiness/A–J change; `compatible:false`, strict BLOCKED, original preload NOT_EXECUTED; [docs/0058](0058-moji-linux-boot.md).

66. Linux exact-file open/save, main fs and window close: the Linux host now clears the window on GTK `delete-event`, fails pending work, keeps the host alive for a `get-window-state` liveness query, and lets the `--hold` loop exit with `reason:"window-closed"`; the test-only `--hold-close-after-ms` exercises the same `gtk_window_close` path. `main-read-file`/`main-write-file`/`main-stat` cover app sources, app-local `.appData`/`.userData`, and exact session-granted files with canonical-path checks, 256 KiB read/write and 400 KiB base64 limits, symlink/traversal/outside-read denial, and session-only grants. `main-open-dialog`/`main-save-dialog` open real GTK choosers on the main thread; open grants the selected exact file read+write (editor save-back), save grants write; single selection and no human-selection evidence. The private JSC context is now created after WebKit initialisation instead of after the first WebView, so pre-window settings fs works without re-stalling page loading. New Linux tests cover app-local fs, a symlink escape, open-dialog read/write, save-dialog write and window close; `node --test tests/nodeless-runtime.test.cjs` is 19 PASS / 0 FAIL / 20 SKIP and `npm test` with the pinned Moji source is 499 tests / 468 PASS / 0 FAIL / 31 SKIP. Human dialog selection/overwrite confirmation, directory grants/readdir/mkdir, export/print, grant persistence/revocation, `app.quit`/menu/tray, IME/AX, native frame authority and macOS parity remain NOT RUN/IMPLEMENTED. CI run 39547063739 at head `ce09857` passed `linux-native` (1m42s), `moonbit` (54s) and `macos` (3m43s); the macOS job exercises the macOS host, not this Linux host. `compatible:false`, strict BLOCKED and original preload NOT_EXECUTED; [docs/0059](0059-linux-file-and-close.md).

67. Linux host-loss, GTK main-loop and read-only save hardening: a manual file-dialog attempt exposed three lifecycle failures. First, when the host closed while nodeless wrote an `app-reply`, `write()` raised SIGPIPE and killed the runtime; both `native/nodeless/host_client.c` and the Linux host now ignore SIGPIPE, so host loss becomes EPIPE/`HOLD_EXIT reason:"host-lost"`. Second, `gtk_main()` returning after a window/dialog close hit the host's `_exit(2)` fail-closed path while a control request was in flight; the host now re-enters `gtk_main`, keeps the session alive until the control thread processes shutdown, cancels an active chooser before closing its parent, and logs `host-exit status/reason` under debug. Third, `g_file_set_contents` requires parent-directory write permission even when the exact file is writable; the host falls back to a direct exact-file write only for `EPERM`/`EACCES`, treats `EROFS` as `ELECTRON_MBT_FILE_READ_ONLY` (prelude `EROFS`), and does not truncate on other failures. Regression tests `host loss during an explicit hold does not SIGPIPE the runtime` and `Linux main write falls back when the parent directory is read-only` pass; the reload test now accepts either pending-reply rejection or stale-nonce denial, removing a timing flake. Local `node --test tests/nodeless-runtime.test.cjs` is 21 PASS / 0 FAIL / 20 SKIP and `npm test` with the pinned Moji source is 501 tests / 470 PASS / 0 FAIL / 31 SKIP; Moon JS/native 145/178. CI run 39713769966 at head `86355f2` passed `linux-native` (1m45s), `moonbit` (1m18s) and `macos` (4m10s); the macOS job exercises the macOS host, not this Linux host. The reported save target `~/Downloads/markdown.md` is on a read-only root mount (`/ ... ro`), so in-place save correctly returns the read-only error; a workspace copy is the supported test path. Human Open/Save acceptance, the 1-hour dialog timeout, directory grants, export, grant persistence and native frame authority remain NOT RUN/IMPLEMENTED; `compatible:false`, strict BLOCKED and original preload NOT_EXECUTED; [docs/0059](0059-linux-file-and-close.md).

68. Linux dialog timeout and deterministic test serialization: the host control thread still used the ordinary 15-second request wait for `main-open-dialog`/`main-save-dialog`, while the nodeless client already waits one hour. A chooser left open for more than 15 seconds made the host `_exit(2)`; this was the "crash" seen after the file chooser had been open for a while. Dialog requests now use the same 3600-second bound; `main-open-dialog`/`main-save-dialog` are the only special cases. A regression test keeps a real chooser open for 16 seconds via the test-only auto-select delay and completes the read/write flow. The global `npm test` script now uses `--test-concurrency=1` because GTK/window tests and other test files sharing one X display raced when files ran in parallel; the serial full suite is 502 tests / 471 PASS / 0 FAIL / 31 SKIP and the Linux nodeless suite is 22 PASS / 0 FAIL / 20 SKIP. Human Open/Save acceptance is still NOT RUN, and the 1-hour dialog bound, directory grants, export, grant persistence and native frame authority remain open. CI run 39736298608 at head `836d5a9` passed `linux-native` (1m55s), `moonbit` (1m8s) and `macos` (3m53s); the macOS job exercises the macOS host, not this Linux host. `compatible:false`, strict BLOCKED and original preload NOT_EXECUTED; [docs/0059](0059-linux-file-and-close.md).

69. Manual Linux Moji Open/Save/reopen observation: one human session on the repaired host selected `_build/markdown.md` through the real GTK chooser, saved as `_build/Untitled.md` (4 bytes, `aaaa`), reopened `_build/Untitled.md`, and exited with `status=0 reason=control_thread_main`. The chooser stayed open beyond the old 15-second host bound; the 3600-second dialog bound and 16-second regression test are in place. The save used the writable workspace; `~/Downloads` remains read-only. Settings writes to `.appData/moji/settings.json` were denied because only `.appData`/`.userData` are created, so settings persistence remains partial. This is a single manual observation, not a broad human acceptance or automated evidence; overwrite confirmation, filters, multi-select, export, IME, restart, directory grants, grant persistence and native frame authority remain open. `compatible:false`, strict BLOCKED and original preload NOT_EXECUTED remain; [docs/0059](0059-linux-file-and-close.md).

## Ownership and unfinished wiring

| Area | Owner now | Remaining production connection |
| --- | --- | --- |
| Lifecycle, logical handles, document generations, grants, request ledger | MoonBit `core` | Experimental native host acknowledgements connected; complete Electron event ordering, physical OS close UI acceptance and sender identity remain open |
| Diagnostic decisions | MoonBit `bridge` | Full API inventory and version-bound compatibility evidence |
| JS object reflection, value rejection and module hooks | Node leaf adapters | Wire to core-owned IPC routing, limits and native-attested document context |
| `electron` facade and app event names | Runtime-owned JS leaf over the compiled/core facade | Host-driven ready/quit, real windows, IPC modules and an Electron event-order oracle |
| Synchronous control I/O | C Node-API leaf probe plus experimental M1 native session | MoonBit host session and private framed native socket exist; reentrancy, complete crash/process ownership and OS-attested document sender remain open |
| OS windows and WebView | Real standalone AppKit/WKWebView host plus separate feasibility probes | gpui/AppKit integration, physical UI acceptance, complete BrowserWindow options and isolation equivalence remain open; native close request/cancel ACK is experimentally connected |
| Electron oracle + differential comparator | Separate test fixture plus a MoonBit-owned observation comparator and baseline admission | Runs that reach the real window/IPC surface so the trace proceeds past module evaluation |
| Evidence admission | MoonBit `core` baseline validator, profile validator and JS probe/evidence validators | Signed provenance, native/app compatibility, and any gate upgrade |
| Profile and app inputs | MoonBit `core` profile contract plus pinned app records | Native execution, actual app build/boot closure, or a profile claim |
| Main-local IPC listeners/handlers | MoonBit `core` registries plus Node leaf facade | Actual renderer sender, production ingress, `ipcRenderer` or native E2E |
| contextBridge prerequisites | MoonBit handle registry, JS realm registry, native isolated bootstrap/attestation, B5 test-only repaired-primitive spike (`go` on tested macOS/WebKit), B6-A exposure authority contract, B6-B experimental preload bridge environment | B6 production transport/preload loader/page shim/native host integration, full preload globals and ipcRenderer/WebUtils, full value/error/callback/Promise semantics, native sender/document authority and independent security review |
| QuickJS ABI | Vendored engine, C adapter, native MoonBit package, bounded CJS loader and Node/Electron prelude with host-backed fs/directory metadata | QJS-05 callback/OOM exits, full Node subset, ownership/sanitizer acceptance |
| Embedded scheduler | Pure MoonBit timer contract in `runtime/embedded/` | QuickJS job/nextTick/host-event integration, shutdown and Node parity |
| CJS module registry | In-memory registry, path/package resolver, require-selected package exports and `runtime/app_runner` graph | `fs` broker, dynamic require, ESM, Moji/real-app graph |
| In-process runner | QuickJS engine/context + scheduler + job/CJS entry points | Native supervisor, host loop, fault and process ownership |
| Node-less main runtime | `native/nodeless` source/hash admission (text and binary assets), CJS graph, prelude dispatch, real host window, snapshot-scoped custom app scheme, generated adapted page API, host-event pump, pinned Moji real-renderer boot, test-injected broker E2E, session main user-file grants and test-injected directory grants, bounded directory/metadata fs, main `dialog.showOpenDialog` read grants and `dialog.showSaveDialog` readwrite grants with test-injected selections plus a native open/save cancel smoke, and no-Node audit | Full webContents/event routing, human save selection/overwrite confirmation, grant persistence/revocation, production directory consent/picker, sheet-modal parenting, print-accurate export, real updater/zlib behavior, original preload/contextBridge, human app scenario and strict profile |
| Governance | `compatibility/{decisions,risks,components}.json`, validator, CycloneDX production SBOM, preview-readiness, G0–G4 and verification reports | License selection, signing identity, direct dependency graph or release approval |

Caller-supplied core `host_origin`/`main_frame` arguments are trusted adapter inputs for unit tests, not proof of an authenticated sender. The production adapter must derive them from native frame/document/session state and cannot accept renderer claims. Document grants and pending cancellations do not by themselves secure a disconnected renderer.

## G0 progress (not complete)

- EP-01: baseline/probe admission is implemented; the 0005 reproducer is a regression test.
- EP-06: profile schema, ADR, compiled admission and CLI integration are implemented. Native authority and actual renderer ingress are not connected.
- EP-05: the inventory collector and pinned Moji/jmd records are present. Pinned checkouts were installed with `npm ci --ignore-scripts` in an isolated workspace; Moji `typecheck` and both builds PASS, with source/main/preload/renderer hashes in `compatibility/apps/*/build-provenance.json`. Lock-driven production closures contain 174/88 packages, 0 native addons and are recorded in `compatibility/apps/*/production-closure.json`. An isolated M1 boot attempt now passes `setName`/`getPath`/`setPath`, acquires a real isolated single-instance lock, and registers main-local `ipcMain` handlers. It builds a bounded main-local Menu template model, creates the BrowserWindow with position/minimum-size/background options, and then FAILS in a structured diagnostic at preload: `ELECTRON_MBT_PRELOAD_UNSUPPORTED_API`, first unsupported API `contextBridge.exposeInMainWorld`. The preload realm exposes recording proxies only; no contextBridge/ipcRenderer is implemented. The Menu model does not install an NSMenu and icon/autoHideMenuBar are not applied. This is an M1 preload blocker; the separate adapted Node-less renderer boot (item 50) does not resolve it. Boot/first-use traces, original-preload runtime and full app scenarios remain NOT RUN.
- EP-32: decisions/risks/components ledgers and validation are present. Root license, signing identity, clean Mac and interactive QA remain blocked.

G0 therefore stays open until the boot/first-use closure, native authority and app scenario evidence are recorded. No polished issue is closed by this progress.

## G1 progress (partial)

- EP-02, EP-03 and EP-04 are integrated on this branch; the main-local IPC stack, native host and contextBridge prerequisites have tests and macOS probes.
- EP-08/R1a is partial: the pinned QuickJS ABI passes eval/throw, value lease, job, deadline and call-argument tests. QJS-05 callback/OOM exits, ownership/sanitizer review and the full MOD matrix remain open.
- EP-09 has a pure timer contract with deterministic ordering/limits. It is not yet connected to QuickJS jobs or host events.
- EP-11 has an in-memory CJS registry, QuickJS cycle/cache/identity tests and a Node-less fixture graph with package `exports`. The pinned Moji main graph and real renderer assets now run Node-lessly; the `fs` broker, dynamic require and ESM remain open.
- EP-09/10 have an in-process runner and `runtime/app_runner` main runtime with nextTick/jobs/timers and async handler settle. A native host window, custom-scheme asset loading and an adapted page-call event pump are connected; full event routing, `fs`, process supervision and fault tests remain open.
- EP-10/EP-15 production supervisor and snapshot/origin integration are not yet on this branch. The experimental M1 runner is not the Node-less supervisor.
- G1 remains open. No compatibility row is verified.

## G2 progress (partial)

- The adapted Node-less runtime now serves the renderer from a staged snapshot over `electron-mbt-app://`, installs the generated page adapter at document start and dispatches bounded page calls into QuickJS `ipcMain` handlers. The deterministic fixture and the pinned Moji real renderer both pass; see [docs/0044](0044-nodeless-adapted-app-renderer.md). Main-side fs now includes bounded directory/metadata stat, readdir and mkdir ([docs/0048](0048-nodeless-directory-fs.md)), and test-injected session directory grants extend those calls to a canonical user-selected subtree ([docs/0049](0049-nodeless-directory-grants.md)).
- The Node-less host now owns the document window/generation, advances it on reload, and rejects stale `app-request` events before Main dispatch; plain and adapted reloads reach generation 2, and a test-only stale injection is rejected while the current event is handled ([docs/0053](0053-nodeless-document-identity.md)). The adapted ingress release and the injection control remain test-only.
- The original preload/contextBridge, production file/dialog/export/update services, full `webContents` events, child frames, cancellation/deadlines, a production directory picker/consent path and human app scenarios remain open. Strict `electron-nodeless-v1` stays blocked.

## Experimental M1 native execution (partial)

The standalone native macOS host and a thin Node runner are integrated as an explicit experimental lane. Private control/navigation/event socketpairs pass bounded envelopes through compiled MoonBit session gates, with native AppKit windows and WKWebView navigation on the main thread. Navigation waits run off the Node main thread; a separate event channel invalidates MoonBit document grants when native WebKit reports content termination. The experiment exposes a small CJS app/BrowserWindow subset under the explicit `--experimental-m1` flag only; unflagged `run` still rejects. The same test app main and dependency resolve one Electron facade without rewrites. See [M1 boundaries](0002-native-host.md).

On this integration SHA (macOS arm64 / SDK 26.5), the following were executed and passed: `scripts/m1-macos-smoke.cjs` (real WKWebView create/load/show/hide/title/URL/bounds/destroy, stale-generation denial, source hash preservation, child exit), `scripts/m1-app-smoke.cjs` (unchanged CJS fixture), `scripts/m1-invalid-wire.cjs` (malformed identifiers and untrusted frames rejected before dispatch), `scripts/m1-load-deadline.cjs` (queue-inclusive deadline and worker interrupt), `scripts/m1-host-loss.cjs` (host loss, failed launch cleanup and no spurious ready/closed events), `scripts/m1-load-event-chain.cjs` (failure/retry and listener exception separation), the native contextBridge prerequisite probes `context-bridge-native`, `context-bridge-bootstrap-native` and `context-bridge-preload-native` (bounded handles, one-shot attestation, failed-preload denial, same-URL reload/window-destroy revocation), and the B5 test-only spike `scripts/m0-context-bridge-probe.cjs` (checkpoint 1/2 PASS, decision go; Electron baseline differential NOT RUN locally). NOT RUN in this integration: `m1-bounds-oracle.cjs` against Electron, the WebKit termination/private-selector lanes, the native close-gesture simulator, interactive IME/accessibility and a real third-party app. The B5 spike is test-only and does not prove production `contextBridge`, complete Electron event ordering, renderer-origin attestation or a packaging result. No acceptance row becomes verified.

## Open milestone gates

1. **M0**: preserve exact Electron source commit, toolchain/core checksums and macOS/SDK/WebView revisions; prove safe synchronous function proxies across isolated worlds, nested/reentrant calls and callback identity; extend unchanged fixtures; choose a real app and collect comparable size/process/cold-warm baselines. CI now pins the installer script SHA-256, the versioned toolchain URL and the installed `moon`/`moonc`/`moonrun` SHA-256s; upstream publishes no signed checksums and versioned objects expire (~60 days), so the pin fails loudly and must be re-recorded deliberately. A MoonBit-owned differential harness compares the unchanged oracle fixture on both runtimes; the electron.mbt run currently aborts at `ipcMain.on`. Baseline admission now rejects incomplete, unpinned, source-mismatched and empty-observation references before the candidate starts, and probe reports with missing required observations are invalid rather than a PASS. CI records the macOS SDK and WebView environment with each run, but the revision pins themselves remain open. `wksyncbridge` recorded that no public WebKit API yields a native world-crossing function proxy; the 2026-10-18 B5 spike's repaired shared-DOM/HMAC candidate passed checkpoint 1/2 and recorded `go` on one macOS/WebKit build, but it is test-only, not an Electron engine proxy, and the Electron baseline differential is CI-only. `syncIsolatedContextBridge` therefore stays open pending B6 and independent review. B6-A provides the exposure authority contract, B6-B the opt-in preload environment, B6-C an experimental synchronous transport E2E, B6-D the semantics matrix and B6-E the evidence/security-review packet; the admitted-descriptor binding closes same-key page materialization for deterministic descriptors (dynamic/non-deterministic preloads fail closed), while the independent review, arbitrary API keys, full preload globals/ipcRenderer/WebUtils, frame policy and page self-DoS remain open. `wknative` recorded executed traces for trusted event-posted input, resize/DPI observation, native pasteboard and in-process AX reads, with focus/blur, OS paste, IME, VoiceOver and hardware input explicitly NOT_RUN, so `nativeAcceptance` stays open. No M0 completion is asserted.
2. **M1**: native MoonBit host, gpui integration, real Node runner, `app`, `BrowserWindow`, private negotiated session transport, native events/reentrancy/cancellation, source-preserving launcher and controlled app-origin resource serving.
3. **M2**: isolated preload loader, synchronous and asynchronous contextBridge, ipcMain/ipcRenderer and listeners, error/clone semantics, dialogs/files/clipboard, sender attestation, navigation revocation, fault injection and all bounded resource ledgers.
4. **M3**: actual Electron application acceptance, pack with fixed Node and production dependencies, signing/notarization, verified SBOM/license notices and checksums, no hidden Chromium, full size/startup/memory/process measurements, distribution and security-update responsibilities.
5. **M4**: the remaining platform profiles and APIs in the design, including Windows/Linux backends. ESM, native addons, ASAR and update behavior must receive separate compatibility evidence, not be inferred from CJS probe success.

## Evidence rules

1. `moon check`, `moon test --target js`, `moon test --target native` and the CJS build run in the `moonbit` CI job. Node integration tests require that real compiled output. A generated substitute core is prohibited.
2. `npm test` covers the complete current Node suite; `test:leaf` is intentionally narrower. Tests use `What` names and reject unsupported values instead of accepting degraded representations.
3. macOS probe and Electron baseline outputs are uploaded as CI artifacts. Their actual CPU/OS/SDK/WebKit versions must be read from the artifacts before claiming any supported environment. Headless/hosted observations do not replace interactive IME, accessibility or real-app acceptance.
4. A transport watchdog PASS proves only bounded behavior of the tested call. It does not prove that a complete Node/host/WebView process tree is terminated or that a public Electron API preserves reentrant ordering.
5. No acceptance row is `verified` without immutable environment/fixture/runtime evidence for that entire row. Skipped and NOT_RUN results are never PASS. A missing, null or mistyped required observation makes a report invalid; it is not a negative result and cannot support a compatibility verdict.
6. Admission details are in [baseline-admission.md](baseline-admission.md) and [probe-admission.md](probe-admission.md). These documents describe shape/completion/provenance checks, not signed provenance or native compatibility.

## Delegation status

Implementation delegation through the GitHub Codex integration was attempted on PR #1. The bot replied that a repository environment must first be created, so no delegated implementation execution was confirmed. The implementation was written by the coordinating agent. Independent code review is requested on the implementation PR and its actual response belongs in the PR record; an implementation-environment error is not a review result.

## Electromoon rename and dual CLI (2026-10-23)

- Renamed the MoonBit module target to `f4ah6o/electromoon`, moved the native
  CLI package from `native/nodeless` to `cmd/emoon`, and renamed the legacy Node
  CLI to `cmd/legacy-node.cjs`. The GitHub repository rename is still an owner
  action; the README states that it is pending.
- Added the Node reference CLI `cmd/emoon.cjs` with `init`, `inspect`, `migrate`
  and `dev`. `doctor` and `run` delegate to a resolved native runtime; the Node
  CLI never reimplements the runtime. The shared workspace is `.emoon/` and the
  migration report is `.emoon/migration-report.json` with `compatible:false`.
- Added the native `emoon` `help`, `version`, `doctor` and `--profile` admission
  paths while preserving the existing `run` behavior. `doctor` validates the
  manifest, hashes, graph, profile and adapter without launching the app. The
  native `init`/`inspect`/`migrate`/`dev` ports are not implemented yet.
- Added `scripts/migrate-app.cjs`, `scripts/dev-flow.cjs`,
  `scripts/build-cli.cjs`, `moon-binstall.json`, the MIT `LICENSE`, `SECURITY.md`
  and docs 0060–0063. `moon-binstall.json` maps `cmd/emoon` and `cmd/emoon-host`
  to release assets, but no GitHub Release or Mooncakes publication exists.
- Verification on this Linux host: `moon test --target js` 145 PASS;
  `moon test --target native` 178 PASS; the new `tests/emoon-cli.test.cjs` 10
  PASS; `npm test` 479 PASS / 1 FAIL / 32 SKIP. The failure is the Linux
  slow-dialog timing test (`open dialog survives beyond the ordinary 15-second
  control timeout`), which passed on an isolated manual rerun at 17.9 s with the
  selected file updated; the suite run recorded a shorter duration. The native
  adapted fixture and the Node `emoon dev` flow reach `status:"PASS"` with
  `pageTitle:"migrate-fixture-ready"` and `compatible:false`.
- Not run: `moon publish`, GitHub Release creation, `moon binstall`,
  `npm publish`, macOS native execution/signing, and clean-machine install.
  No compatibility row is promoted.

## Dialog timeout test isolation (2026-10-23)

- Root cause of the local slow-dialog failure: the X display used for development
  (`:10.0`) is an interactive xrdp/xfce session. The modal GTK chooser takes
  focus, and the next Enter or click from the person at the machine accepts it
  before the 16-second delay. This is test-environment isolation, not a host
  timeout regression; the same test is stable under CI's Xvfb display.
- The regression is now split. The real 16-second chooser test runs only when
  `ELECTRON_MBT_ISOLATED_DISPLAY=1` is set (the CI `linux-native` job does this
  inside Xvfb). A new test-only `ELECTRON_MBT_LINUX_DIALOG_HOLD_MS` path keeps
  the open-dialog request pending for 16 seconds without mapping a chooser, so
  the host's dialog-specific wait is also exercised on interactive desktops
  without stealing focus. The hold is gated on `ELECTRON_MBT_TEST_MODE=1`, a
  valid `AUTOSELECT` target and the explicit hold variable; production dialogs
  still use the real GTK chooser.
- Local `ELECTRON_MBT_REQUIRE_NATIVE_HOST=1 node --test
  tests/nodeless-runtime.test.cjs`: 22 PASS / 0 FAIL / 21 SKIP. The real-chooser
  test SKIPs locally, the new hold test PASSes in 17.8 s, and the open/save
  dialog tests PASS. The full `npm test` result is recorded with the native CLI
  work so the counts are not split across two runs.

## Native `emoon` developer commands (2026-10-23)

- Native `emoon` now implements `init`, `inspect`, `migrate` and `dev` in
  addition to `run`/`doctor`/`version`/`help`. `dev` stages and then invokes
  doctor/run in the same process; the runtime is not reimplemented.
- The shared contract lives in `cli/emoon_contract`: argument parsing, config
  merge, path rules, entry-type classification, the static scanner, the schema-2
  manifest writer and the schema-3 adapted adapter generator. The Node reference
  remains the oracle.
- The native staging FS primitives are bounded in `cmd/emoon/file_io.c`: app-root
  containment, symlink and `..` rejection, 4096 files / 64 MiB / 16 MiB, atomic
  JSON writes and mode-preserving copies. Inspect uses 16384 entries / 8192
  files / 256 MiB / 32 MiB / depth 64. Any symlink under the app tree, a
  symlinked stage, config or `package.json` fails closed.
- The Node reference was aligned with the same contract: `--config` is
  app-relative and root-constrained, inspect rejects symlinks, `.git`/`.emoon`
  and `node_modules/.cache` are skipped by path, `package.json` is bounded to
  64 KiB, and common FS errors map to documented `ELECTRON_MBT_*` codes.
- The builtin classification table now covers the Node 24.21/24.22
  `builtinModules` set (unsupported entries stay unsupported). The native and
  Node scanner outputs match on the parity fixtures and corpus forms.
- Linux parity (`tests/emoon-cli-parity.test.cjs`): 13 PASS. Stage trees,
  file modes, `source-manifest.json`, `nodeless-app.json` and
  `adapted/page-api.js` are byte-identical on the fixtures; reports differ only
  in `tool.impl` and the absolute `appDir`. The adapted native `dev` window
  reaches `status:"PASS"`, `pageTitle:"migrate-fixture-ready"`, adapter requests
  1 and `compatible:false`.
- Validation on this Linux host:
  - `moon test --target js`: **163 PASS / 0 FAIL**.
  - `moon test --target native`: **196 PASS / 0 FAIL**.
  - `node --test tests/emoon-cli.test.cjs`: **10 PASS / 0 FAIL**.
  - `node --test tests/emoon-cli-parity.test.cjs`: **13 PASS / 0 FAIL** (the
    window E2E was included).
  - `ELECTRON_MBT_REQUIRE_NATIVE_HOST=1 node --test
    tests/nodeless-runtime.test.cjs`: **22 PASS / 0 FAIL / 21 SKIP**. The real
    16-second chooser test is skipped locally (it needs
    `ELECTRON_MBT_ISOLATED_DISPLAY=1`); the unmapped control-hold test passes in
    17.77 s.
  - `npm test`: **526 tests / 493 PASS / 0 FAIL / 33 SKIP**.
- Not run: macOS native execution of the developer commands, `moon publish`,
  GitHub Release creation, `moon binstall`, `npm publish`, signing/notarization,
  human dialog UI and a clean-machine install. No compatibility row is promoted.

## Manual demo window (2026-10-26)

- Added [`fixtures/manual-demo-app`](../fixtures/manual-demo-app/) and
  [`scripts/try-emoon.cjs`](../scripts/try-emoon.cjs) (`npm run demo:emoon`):
  copy the demo app, run native `init`/`inspect`/`migrate`/`doctor`, then open a
  real GTK/WebKitGTK window with `run --window --hold`. The window stays until
  the human closes it (`--no-launch`, `--reset`, `--rebuild` are available).
- Verified the adapted demo on this Linux host: the report is `status:"PASS"`,
  the page title is `Electromoon manual demo`, the page shows
  `ready: theme=dark`, the initial `window.api.getSettings()` request reaches
  `ipcMain.handle` (`requests:1`, zero reply errors), and a window-manager close
  exits with `HOLD_EXIT reason:"window-closed"` and status 0.
- Documented the trial flow in [`docs/0064-manual-trial.md`](0064-manual-trial.md).
  The demo is a developer convenience, not a compatibility result.
- Page-script finding: the generated adapter defines the exposed name as a
  non-configurable `window` property. A classic script with a top-level
  `const api = window.api` fails in JavaScriptCore with `Can't create dup` and
  never runs. The demo wraps its script in an IIFE and the manual note tells
  users to read `window.api` directly or wrap the script. The original preload
  is still not executed.
- Scope: Linux only; macOS native execution, human dialog UI, publication and
  `moon binstall` remain NOT RUN.

## Unbuilt source trees, dependency skips and `dev --build` (2026-10-26)

- Diagnosed `dist/emoon dev ./_build/Moji --no-launch`: `_build/Moji` is a 1.0.7
  source checkout without `out/` or `node_modules/`. The preflight used to check
  the renderer first and reported "could not detect a renderer directory"; it
  now validates `package.json` main first and returns
  `ELECTRON_MBT_MIGRATE_BUILD_MISSING` with the missing path and the
  `npm run build` / `dev --build` hint. The Node reference matches.
- Inspect and staging now skip `.git`, `.emoon` and `node_modules` at any depth.
  This removes the `node_modules/.bin/*` symlink failure and the 8,192-file
  inspect limit failure on real app repositories; `node_modules` never enters a
  stage. Symlinks in the remaining tree still fail closed.
- When `dirname(main)` is not the app root, the whole main output directory is
  staged. This covers electron-vite multi-entry builds such as Moji 1.0.7's
  `out/main/main.js` plus `pngWorker.js`; the worker is present in the manifest
  and the doctor graph resolves it.
- Added opt-in `emoon dev --build` (native and Node). It checks `scripts.build`
  and `node_modules/`, runs `npm run build` in the app root (stdout redirected to
  stderr so JSON stdout stays clean), then continues with init/inspect/migrate/
  doctor. It never runs `npm install`. Missing output, missing dependencies and a
  failing build report `ELECTRON_MBT_MIGRATE_BUILD_MISSING`,
  `..._BUILD_DEPS` and `..._BUILD`. The Node `dev` also forwards `--page`.
- Real-app checks on this Linux host:
  - `dist/emoon dev ./_build/Moji --no-launch` now reports BUILD_MISSING naming
    `out/main/main.js`; the Node CLI reports the same code/message.
  - `dist/emoon dev ./_build/moji-check --no-launch --force` (built Moji 1.0.5
    with 19k-file `node_modules`) reaches inspect/migrate/doctor with a 109-file
    stage and doctor `ready`; no node_modules in the stage.
  - `dist/emoon run _build/moji-linux-app --window --hold --entry
    out/main/main.js` shows `Moji v1.0.5`; WM close gives
    `HOLD_EXIT reason:"window-closed"` and exit 0.
- `--force` fallback: when an existing stage cannot be removed (for example a
  stage owned by another UID), both CLIs rename it to `.emoon/app.stale` (or
  `.stale-N`), warn on stderr, and create a fresh stage. The real `_build/Moji`
  run hit this: the old stage was owned by `nobody`, and `dist/emoon dev
  _build/Moji --force --no-launch` now moves it aside, stages 1.0.7 (141 files)
  and reaches doctor `ready`.
- Validation: `moon test --target js` **163 PASS**, `--target native` **196
  PASS**, `tests/emoon-cli.test.cjs` **10 PASS**, parity **20 PASS**, `npm test`
  **533 tests / 500 PASS / 0 FAIL / 33 SKIP**.
- Not run: `_build/Moji` 1.0.7 `npm install`/`npm run build` and its
  `dev --build` (the user selected the prepared 1.0.5 stage); macOS native,
  publication, `moon binstall`, signing and human dialog UI remain NOT RUN.

## `node:crypto` subset (2026-10-26)

- Implemented `node:crypto` / `crypto` in the embedded Node prelude:
  `createHash('sha256'|'sha-256')` with `update` over strings, Buffer,
  ArrayBuffer and number arrays and `digest` in hex/base64/Buffer;
  `randomUUID` (v4), `randomBytes` and `getRandomValues`. Unsupported
  algorithms, encodings and WebCrypto surfaces fail closed.
- Host entropy is `getrandom` on Linux, `arc4random_buf` on macOS (compiled, not
  run here) and `/dev/urandom` elsewhere; there is no `Math.random` fallback. The
  random length is capped at 65,536 bytes and hash input at 64 MiB.
- Registered `crypto` in the builtin surface as a planned/implemented subset;
  the original preload is still not executed.
- Evidence: native prelude crypto test (empty/abc SHA-256 vectors, base64, UUID
  v4 shape/variant/distinctness, random bytes, `getRandomValues`, unsupported
  algorithm), `moon test --target native` **197 PASS**, `--target js` **163
  PASS**, `npm test` **533 tests / 500 PASS / 0 FAIL / 33 SKIP**, parity **20
  PASS**. The Moji 1.0.5 adapted hold still reaches `HOLDING`/`HOLD_EXIT` and
  exits 0.
- Moji 1.0.7 now advances past `node:crypto`; the next main-eval failure is
  `ELECTRON_MBT_MODULE_DEPENDENCY:node:v8`. `node:worker_threads`,
  `node:perf_hooks`, zlib, the 1.0.7 adapted manifest and a normal window mode
  remain. macOS entropy and a full 1.0.7 window are NOT RUN. See
  [docs/0065](0065-node-crypto.md).

## Moji 1.0.7 main/window boot (2026-10-26)

- Added minimal import/boot surfaces for `node:v8` (`getHeapStatistics` with a
  fixed 256 MiB limit), `node:worker_threads` (import-only, fail-closed
  `Worker`), `node:perf_hooks` (local mark/measure), `node:os` (host
  placeholders) and `electron.protocol` (`registerSchemesAsPrivileged` no-op;
  `handle` stores but does not execute; `moji-asset://` is not served). The
  global `performance` object is exposed.
- The plain Moji 1.0.7 stage now reports `status:"PASS"` for the main/window
  runtime: `windowLoaded:true`, `pageTitle:"Moji v1.0.7"`, `mainError:""`,
  `compatible:false`. It is **not** a working app: `rendererLoaded:false`,
  `rootChildren:0`, `apiPresent:false`, `adapted.requests:0`; a plain stage has
  no adapted API and protocol handlers are not executed.
- Moji 1.0.5 adapted hold remains `HOLDING` → `HOLD_EXIT reason:"window-closed"`,
  exit 0.
- Tests: `moon test --target native` **198 PASS**, `--target js` **163 PASS**,
  `npm test` **533 tests / 500 PASS / 0 FAIL / 33 SKIP**, parity **20 PASS**.
- Limits: `worker_threads` is not implemented, `zlib.createDeflate` is still
  unsupported, `os`/`v8` values are placeholders, and the 1.0.7 adapted API
  (drafts, openMany, readPath stream) is NOT RUN. See [docs/0066](0066-node-runtime-surfaces.md).

## Moji 1.0.7 adapted renderer and preload capture (2026-10-26)

- Added `scripts/capture-preload-api.cjs`, a generic dev-time capture tool for
  built contextBridge preloads. It evaluates the preload once with a fake
  `electron`, records the first IPC call/event per exposed function, supports
  explicit `--operation method=operation` overrides, and writes a schema-3
  adapted manifest. It does not execute the preload in the app.
- Added the generic reserved operation `emoon:read-file` for granted files
  (host `main-read-file`, 256 KiB cap), returning
  `{ok,path,content,sizeBytes,sizeProfile}` for adapted manifests that map a
  streamed read to a simple read.
- Captured the built Moji 1.0.7 preload (23 calls, 6 topics, 1 unsupported
  `getDroppedPath`) with `readPath=emoon:read-file`, staged it with
  `init --api`/`dev` (143 files, doctor `ready`), and ran it on Linux:
  `rendererLoaded:true`, `apiPresent:true`, initial UI text `New / Open / Save /
  Preview / Editor / Export` and `A LIGHTWEIGHT, SIMPLE MARKDOWN READER`,
  adapted 4 requests / 0 reply errors / 0 rejected, `HOLDING` then
  `HOLD_EXIT reason:"window-closed"`, exit 0.
- Added a generic preload-capture test fixture/test. Validation: native **198
  PASS**, JS **163 PASS**, npm **534 tests / 501 PASS / 0 FAIL / 33 SKIP**,
  parity **20 PASS**.
- Limits: file open/edit/save/drag/export/human dialogs are NOT verified;
  `getDroppedPath`, `moji-asset://`, zlib compression and real worker threads
  remain limited. No compatibility claim.

## Main fs rename/unlink (2026-10-26)

- Added generic `main-rename` / `main-unlink` host operations and
  `fs.renameSync` / `fs.unlinkSync` plus `fs.promises.rename`/`unlink` in the
  Node prelude. They use the existing write policy (app `.appData`/`.userData`
  or a write-granted exact file), canonical paths, directory rejection and
  `ELECTRON_MBT_FILE_*` error mapping.
- This fixes Moji 1.0.7's atomic settings/draft persistence path: the initial
  `Could not restore recovery drafts: ELECTRON_MBT_MAIN_ERROR` toast is gone.
  The adapted 1.0.7 initial UI still reports `rendererLoaded:true`,
  `apiPresent:true`, 4 requests / 0 reply errors; the 1.0.5 adapted hold remains
  PASS.
- Validation: native **198 PASS**, JS **163 PASS**, npm **534 tests / 501 PASS /
  0 FAIL / 33 SKIP**, parity **20 PASS**. File open/save, export and human
  dialogs remain NOT verified; no compatibility claim. See
  [docs/0068](0068-main-fs-rename.md).

## Adapted sender authority, events and AbortController (2026-10-26)

- Fixed the adapted main bridge to pass the real `BrowserWindow.webContents`
  object as `event.sender` (`senderFrame:null`, `mainFrame` alias,
  `id`, `isDestroyed`). This satisfies Electron apps' trusted-sender checks;
  Moji 1.0.7's `isTrustedSender` had rejected every handler with `forbidden`.
- Implemented `webContents.send` through a new generic Linux host
  `send-adapted-event` operation that evaluates the page adapter's
  `__electronMbtDispatch` for a manifest topic. Added `AbortController` /
  `AbortSignal`, and propagated main handler error messages to the page error.
- A probe page with the captured 1.0.7 API now receives
  `openDialog() = {ok:true, sessionId, total:1}` after the host dialog and
  auto-select, where it previously failed with `MAIN_ERROR`.
- Validation: native **198 PASS**, JS **163 PASS**, npm **534 tests / 501 PASS /
  0 FAIL / 33 SKIP**, parity **20 PASS**. Moji 1.0.7 initial renderer and Moji
  1.0.5 hold remain PASS. Open-many progress/file open/render, macOS event
  delivery, zlib, worker threads and human dialogs remain NOT verified. See
  [docs/0069](0069-adapted-sender-events.md).

## Moji 1.0.7 open, edit and save (2026-10-26)

- Trusted-sender fix: adapted main handlers receive the real
  `BrowserWindow.webContents` as `event.sender` and `senderFrame:null`, so
  Moji's `isTrustedSender` no longer rejects every IPC call with `forbidden`.
- Added Linux main-to-page event delivery (`send-adapted-event`), app-code host
  operation allowlisting/dispatch for `main-rename`, `main-unlink` and
  `send-adapted-event`, `AbortController`, detached-work pumping, and
  `ipcMain.on` listener dispatch.
- Added generic `main-mkdir` / `main-read-dir` and ensured `app.getPath`
  app-data directories exist. Fixed new-file path allocation/free mismatches
  that crashed the host at draft/settings startup.
- Verified Moji 1.0.7 end to end for the core reader workflow: Ctrl+O native
  dialog → open-many progress/done → `emoon:read-file` → rendered preview
  (`Emoon open test` / `UNIQUE_OPEN_MARKER_12345`); Editor + Ctrl+S wrote
  `EDITED_BY_EMOON` to the selected file; `.appData/<app>/settings.json`
  persisted `recentFiles` / `lastDialogDirectory` and the next launch shows the
  recent file. Initial UI has no draft-recovery toast and host stays alive.
- Validation: native **199 PASS**, JS **163 PASS**, npm **534 tests / 501 PASS /
  0 FAIL / 33 SKIP**, parity **20 PASS**; 1.0.5 adapted hold remains PASS.
- Remaining: draft autosave, export/PDF, drag-and-drop, settings panel,
  `update:get-state`, macOS native and publication items. No compatibility
  claim. See [docs/0069](0069-adapted-sender-events.md) and
  [docs/0070](0070-main-fs-directories.md).

## Moji 1.0.7 drafts and settings UI (round 4)

- Verified draft autosave: `drafts:save` → `main-write-file` → `main-rename`
  created `.appData/<app>/drafts/manifest.json` and a `.md` draft; the next
  launch restored the Untitled document.
- Verified the Settings panel (General/Preview/Editor/Shortcuts) and the
  persisted recent-file welcome screen.
- Verified the Export dialog UI (PDF/HTML/PNG, page size, orientation); the
  export pipeline itself still requires a hidden export BrowserWindow and
  `webContents.printToPDF`.
- Added a native regression assertion that `ipcMain.on` (send-style) listeners
  are dispatched alongside `ipcMain.handle`.
- Validation: native **199 PASS**, JS **163 PASS**, npm **534 tests / 501 PASS /
  0 FAIL / 33 SKIP**; 1.0.5 adapted hold remains PASS. Remaining: export/PDF,
  drag-and-drop, `update:get-state`, macOS native/publication. No compatibility
  claim.

## Offscreen PDF/HTML export (2026-10-27)

- Added a hidden offscreen BrowserWindow backed by a private WebKitWebView,
  `load-export-file`, `export-execute-js`, `export-print-pdf` and
  `destroy-export-window`; `fs.promises.open` FileHandle support for the app's
  export-source writer; and `BrowserWindow.fromWebContents`/registry fixes.
- PDF is produced from a full-document WebKit snapshot via Cairo (A4/Letter/
  Legal, portrait/landscape). It is a real but raster PDF: 3885 bytes,
  `%PDF-1.7`, A4 1 page in the probe. HTML export writes the exact HTML string
  (75-byte probe). Both used the actual pinned Moji main through `exportAs`.
- A subagent review found and we fixed/limited: export callback timeouts and
  lifetime, directory-list/PDF frame caps, symlinked recursive mkdir, stale
  window registry, second-export-view sharing and export teardown. Remaining
  limits: raster PDF/no print CSS/page breaks, no Promise-aware
  executeJavaScript (font wait is skipped), PNG, drag-and-drop, macOS and the
  actual toolbar-button path (probe used the same handler).
- Validation: native **199 PASS**, JS **163 PASS**, npm **534 tests / 501 PASS /
  0 FAIL / 33 SKIP**; 1.0.5 hold PASS; Moji open/edit/save regression PASS. No
  compatibility claim. See [docs/0071](0071-pdf-html-export.md).

## Offscreen data-URL loadURL (resume)

- Added `BrowserWindow.loadURL` support for offscreen `data:text/html` URLs,
  including optional `baseURLForDataURL` insertion. It decodes to an app-local
  temp file, loads via `load-export-file`, and removes the temp file in
  `destroy`; non-data/non-offscreen loadURL still fails closed.
- Verified by switching the export probe main from `loadFile` to `loadURL`:
  PDF `%PDF-1.7`, A4 1 page, 3885 bytes; temp files cleaned up.
- This addresses the export review's `loadURL` gap generically. The pinned
  Moji 1.0.7 build still uses `loadFile`.
- Validation: native **199 PASS**, JS **163 PASS**, npm **534 tests / 501 PASS /
  0 FAIL / 33 SKIP**; 1.0.5 hold PASS; actual app open regression PASS.
- Remaining: raster PDF/print CSS, PNG, drag-and-drop, actual toolbar-button
  automation, macOS. No compatibility claim.

## PNG export (resume)

- Added the app's offscreen PNG path: `BrowserWindow.setContentSize`,
  `webContents.capturePage` (chunked host snapshot reads), `NativeImage`
  (`getSize`/`toBitmap`), positioned `FileHandle.write` via `main-write-at`,
  `zlib.createDeflate` (stored blocks), Buffer integer accessors and
  `Buffer.from(ArrayBuffer, offset, length)`.
- The PNG writer's `${destination}.tmp` is granted alongside the save-dialog
  destination; positioned writes allow the IHDR rewrite and files larger than
  the 256 KiB frame. All write offsets are bounded at 64 MiB and chunks at
  256 KiB.
- Increased the AppRunner promise-job budgets from 64/256 to 4096 so long
  chunked exports do not surface as a false `ELECTRON_MBT_ENGINE` failure.
- Probe results through the actual pinned Moji main: valid 794x1123 RGBA PNG
  (9,845 bytes) and 794x4020 two-slice PNG (94,430 bytes) with host zlib
  compression. PNG remains raster. Existing PDF (3885 bytes) and HTML
  (75 bytes) still pass.
- Validation: native **199 PASS**, JS **163 PASS**, npm **534 tests / 501 PASS /
  0 FAIL / 33 SKIP**; 1.0.5 hold PASS; Moji open regression PASS. No
  compatibility claim.
- Addressed both subagent reviews: incremental stored-block deflate, 16 MiB
  capture/prelude caps and strict size checks, 256 MiB output-offset cap,
  positioned FileHandle writes with short-write failure, O_NOFOLLOW/CLOEXEC,
  capture event flush, no-arg capturePage defaults, Buffer offset defaults and
  shared ArrayBuffer views, and run_jobs yielding rather than failing.
- HiDPI: WebKitGTK snapshots can be CSS- or device-sized. The host now derives
  the ratio from the allocated CSS width and downscales device snapshots to
  CSS. GDK_SCALE=2 probe: 794x4020 / 94,425-byte PNG with all 20 bands. This is
  CSS-resolution output, not 2x native pixels.
- True print-layout PDF: `WebKitPrintOperation` with the "Print to File" PDF
  backend produces a text-selectable A4 PDF (520,046 bytes, Skia/PDF m145;
  `pdftotext` returns PRINT LAYOUT / SELECTABLE_TEXT_MARKER). A failed, timed-out
  or oversized print falls back to the existing Cairo raster snapshot. The
  host/main-write caps are now 700 KiB payload / 950 KiB base64.
- Remaining: very long multi-slice stress, drag-and-drop, actual toolbar
  button automation, macOS. See [docs/0071](0071-pdf-html-export.md).

- Export UI E2E: the actual Export toolbar, format dialog, footer confirm and
  save dialog now run through to a text-selectable print-layout PDF. The probe
  (test-only `--trigger-export-ui`, separate open/save autoselect paths) wrote
  an 18,850-byte Skia/PDF A4 page; `pdftotext` returned `UI E2E` /
  `HELLO_UI_E2E_SAVE`. Root fixes: the adapted page API sends one JSON `args`
  field (string) and app-request events can reach 380 KB, so the CLI event
  buffer and native app payload cap were raised to 1 MiB and the main prelude
  normalizes string/array/`{args}` payloads before dispatch. Remaining after
  this: drag-and-drop and macOS. See [docs/0042](0042-nodeless-main-runtime.md).

## Single-executable bundle (2026-10-27)

- Added native `emoon bundle <app-or-stage> --output <file>`: release/stripped
  CLI prefix + zlib payload + host + app stage + 512-byte footer.
- The embedded launcher extracts to
  `$XDG_DATA_HOME/electromoon/apps/<slug>/app` and
  `$XDG_CACHE_HOME/electromoon/hosts/<host-sha>/emoon-host`, sets `EMOON_HOST`
  and runs the existing `run --window` path. `.appData`/`.userData` are never
  embedded or overwritten.
- `node scripts/build-cli.cjs` now defaults to release+strip; `--debug` keeps the
  old build.
- Moji 1.0.7 evidence: **6,185,192 bytes** single ELF; raw payload 13,108,339;
  stored 3,693,792; app `moji` 1.0.7 / 144 files; `HOLDING`
  `pageTitle:"Moji v1.0.7"`; ~1.2 s to HOLDING; RSS sum ~554 MiB (measurement
  only). Electron baseline in the same checkout: 317 MB.
- Bundle tests cover single-file startup without adjacent host/app, app-data
  sentinel preservation, existing output/missing stage/corrupt payload and
  symlink rejection. macOS/signing/DnD are NOT RUN.

## One-command bundle UX (2026-10-28)

- `emoon bundle [app-dir]` now stages `.emoon/app` when the stage is missing or
  stale, and writes
  `<app>/.emoon/dist/<name>-<version>-<os>-<arch>` by default. A prepared stage
  still requires an explicit `--output`.
- Source-level staleness: the stage manifest, the current `migrate` file set,
  each source hash and the regenerated `adapted/page-api.js` are compared before
  reuse. A changed source re-stages automatically. A stage containing
  `.appData`/`.userData` is never replaced without `--reset-data`.
- New flags: `--dry-run` (plan JSON, no writes, no npm), `--no-stage`,
  `--restage`, `--reset-data`, `--build`, `--quiet`; `--renderer/--page/--api/
  --include/--config` are forwarded to init/migrate. stdout is one JSON line;
  progress goes to stderr.
- `emoon-host` resolution now includes an absolute `PATH` entry after the
  sibling/`dist` layouts, and the C writer reports a missing host as
  `ELECTRON_MBT_BUNDLE_HOST` instead of a stage error. `--name` is validated
  before writing.
- The Node reference CLI delegates `bundle` to the native runtime; it does not
  reimplement staging or bundling.
- Evidence: release-strip CLI **2,537,464 bytes**; bundle/UX tests **17 PASS**;
  CLI/parity **30 PASS**; MoonBit native **203 PASS**, JS **167 PASS**; npm
  **551 tests / 518 PASS / 0 FAIL / 33 SKIP**.
  `dist/emoon bundle _build/Moji` reused the 143-file stage in **0.823 s** and
  wrote **6,231,768 bytes (5.9 MiB)**; `--bundle-info` reports `moji` 1.0.7 /
  144 files, and the isolated-XDG hold run reports `pageTitle:"Moji v1.0.7"`.
  The +46,576 bytes over the 2026-10-27 artifact is the CLI prefix growth; the
  app payload (raw 13,108,339 / stored 3,693,792) is unchanged.
- The current bundle profile remains `electron-nodeless-adapted-v1`; a stage
  without `nodeless-app.json` is refused with a `--api <file>` hint. NOT RUN:
  macOS bundle launch/signing/notarization, Windows, human UI, DnD.

## Custom protocol asset broker (2026-10-29)

- Replaced the silent `electron.protocol.registerSchemesAsPrivileged` no-op in
  the adapted prelude. The scheme must be admitted by the staged
  `assetSchemes`; `bypassCSP`, service workers, code cache and streaming are
  rejected with `ELECTRON_MBT_UNSUPPORTED_PROTOCOL_PRIVILEGE`; an unadmitted
  scheme fails with `ELECTRON_MBT_PROTOCOL_SCHEME_NOT_ADMITTED`. `handle` is
  recorded but never executed (`handlerExecuted:false`).
- The Linux GTK/WebKitGTK host registers admitted schemes before the first
  WebView and serves `scheme://local/<encoded absolute path>` from the app root
  and session document directories. The broker enforces realpath containment,
  image extensions, regular files, `O_NOFOLLOW`, a 4 MiB cap and GET/HEAD.
  Responses carry status, CORS, nosniff, cache and SVG CSP headers; the
  earlier host abort was an extra unref of the `SoupMessageHeaders` that
  `set_http_headers` takes ownership of.
- Test evidence:
  - `node --test tests/asset-protocol.test.cjs`: **8 PASS**. Dialog-granted
    image title `asset-ok-1`, `served:1`, `bytes:68`, `denied:0`; ungranted
    image `asset-error`, `denied:1`, `lastCode:ELECTRON_MBT_ASSET_DENIED`;
    unadmitted scheme stops at main evaluation, no window; traversal
    (`ESCAPE`), symlink escape (`DENIED`), non-image (`TYPE`) and >4 MiB
    (`LIMIT`) are denied with no served bytes; a `crossorigin` image draws to
    canvas and `toDataURL` succeeds, so the CORS header path works.
    WebKitGTK's `set_http_headers` owns the `SoupMessageHeaders`; the earlier
    host abort was an extra unref. Responses now carry status, CORS, nosniff
    and cache headers; `fetch()` to the custom scheme still reports a network
    error (NOT RUN).
  - `node scripts/nodeless-moji-assets.cjs`: **PASS**. Pinned Moji 1.0.7 real
    renderer requested a relative PNG; host `served:1`, `bytes:68`,
    `schemes:["moji-asset"]`, `handlerExecuted:false`. The page probe did not
    expose a plain preview `<img>` (`NOT_EXPOSED`); the controlled asset
    fixture verifies WebKit decoding and `naturalWidth:1`. A separate manual
    run with a 96x96 PNG visibly rendered the preview image
    ([screenshot](images/moji-assets-20261029.png)). Report:
    `compatibility/reports/moji-assets.json`.
  - `node --test tests/apps/jmd-j1.test.cjs`: **2 PASS** synthetic J1.
    `bypassCSP` -> `ELECTRON_MBT_UNSUPPORTED_PROTOCOL_PRIVILEGE`; safe but
    unadmitted -> `ELECTRON_MBT_PROTOCOL_SCHEME_NOT_ADMITTED`; unreachable
    code after the declaration is not evaluated.
  - `node scripts/jmd-j1.cjs`: **PASS expected-rejection** against the pinned
    jmd `f875fc6` checkout. The pinned main stops earlier than the synthetic
    fixture: the CJS loader rejects the `JMD_SMOKE` computed require
    (`ELECTRON_MBT_DYNAMIC_REQUIRE`), so `protocolGateReached:false`. Report:
    `compatibility/reports/jmd-j1.json`. This is fail-closed, not
    protocol-gate evidence.
  - MoonBit native prelude tests: admission/privilege/record-only handler.
  - `node --test tests/nodeless-runtime.test.cjs`: **22 PASS / 0 FAIL / 21
    SKIP** (Linux host available; Moji/pinned tests still skip).
  - `emoon init/migrate/dev/bundle --asset-scheme` writes
    `.emoon/config.json` and the staged `nodeless-app.json`; invalid names,
    duplicates and >4 schemes fail before staging. Node/native stage bytes are
    identical (`tests/emoon-cli-parity.test.cjs`).
  - `npm test`: **563 tests / 530 PASS / 0 FAIL / 33 SKIP**;
    `moon test --target js`: **174 PASS**; `--target native`: **211 PASS**.
- Not run / not implemented: macOS WKURLSchemeHandler, `fetch()` status,
  no-cors canvas taint, SVG direct-navigation, the Moji preview `<img>` probe
  (NOT_EXPOSED; controlled fixture and screenshot PASS), persistent asset
  directories, multi-window, `unhandle` broker shutdown. The pinned raw jmd
  J1 is expected-rejection at the JMD_SMOKE computed require; the separate
  adapted stage reaches a positive (section 69). `compatible:false`, strict
  blocked, original preload NOT_EXECUTED.
- See [docs/0074](0074-custom-protocol-asset-broker.md).

## jmd positive on the adapted Linux profile (2026-10-29)

Pinned jmd 0.2.3 (`f875fc6`) now boots its real Vite renderer in the Linux
GTK/WebKitGTK host and opens a markdown document through a test-injected native
open dialog.

- The upstream checkout is unchanged. `scripts/jmd-adapt.cjs` creates a staged
  copy and records three source edits with before/after SHA-256:
  remove the `JMD_SMOKE` computed require, remove `bypassCSP` from the
  `jmd-file` scheme, and add a CLI-only `test:open-dialog` hook. The bespoke
  `fixtures/jmd-adapted/page-api.js` implements `window.jmd` (IPC calls, pure
  `basename`/`resolveAsset`, event listeners); IPC dispatch stays
  runtime/MoonBit-owned. The original preload is NOT_EXECUTED.
- `nativeTheme` is added to the prelude facade (`shouldUseDarkColors:false`,
  inert listener methods). jmd's `fs.watch`, `dialog.showMessageBox`,
  `screen.getDisplayNearestPoint`, `net`, menu installation and `loadFile`
  query are not exercised; no file-change delivery is claimed.
- `scripts/jmd-positive.cjs` builds the stage, dispatches the real open
  dialog, and asserts: adapted boot/release, page URL, window title
  `note.md — jmd`, initial UI, open dispatch, preview marker, `jmd-file`
  admission, image served (`served:1`, `bytes:68`) and `naturalWidth:1`.
  `handlerExecuted:false`; `compatible:false`.
- Evidence: `compatibility/reports/jmd-positive.json` and
  `jmd-positive-adaptation.json`; screenshot
  [jmd-positive-20261029.png](images/jmd-positive-20261029.png);
  [docs/0075](0075-jmd-positive-adapted.md).
- CI: `.github/workflows/ci.yml` checks out the pinned jmd source, runs
  `npm ci --ignore-scripts` + `npm run build`, then the smoke under Xvfb with
  `CI=true` (missing source/build fails rather than skips). The workflow step
  is NOT RUN in this increment; local evidence is above.
- Save/edit, human input, IME, watcher events, `showMessageBox`, detach/screen,
  and macOS are NOT RUN/out of scope. No strict-profile or compatibility claim.
