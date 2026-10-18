# B7 — strict profile admission plan and first findings

Status: **B7 design work started; the strict profile remains blocked.** The
project owner accepted the B6-C/B6-D transport for B7 design work on
2026-10-18, but that acceptance is not a strict-profile admission. No
compatibility row is promoted. `compatible:false`, strict **blocked**, M0
**OPEN** and the original preload **NOT_EXECUTED** are unchanged.

## Current architecture

- The accepted transport runs in the **Node-backed experimental M1 host**
  (`ExperimentalRuntime`, `--experimental-m1`), opt-in via the B6 flags.
- The strict profile is `electron-nodeless-v1` (`quickjs` /
  `quickjs-native`, implementation **planned**, gate **blocked**). The
  accepted transport has not been ported to that runtime.
- The strict profile's `blockedReason` still lists page-admission ordering,
  arbitrary API keys, full preload globals/ipcRenderer/webUtils, frame
  policy, page self-DoS and strict runtime/B7 evidence.

## Gate 1 — page-admission ordering (closed in the experimental M1 transport; strict runtime actual-before-page open)

The experimental M1 transport now previews the unchanged preload before
navigation. The preview encodes the same production descriptor in the VM, and
the runtime pre-registers that exposure with the MoonBit B6-A authority
(activate/grant/expose) before `load-file`. The page shim then materializes
from the actual WKWebView descriptor. The actual `preload-exposure` event must
match the pre-registered key, descriptor bytes, function count and SHA-256, or
the runtime aborts.

Evidence:

- B6-C and B6-D pass with the pre-registration in front of the page;
- `tests/context-bridge-admission-native.test.cjs` uses a preload whose key
  depends on `process` (`preview-key` in the VM preview, `actual-key` in
  WKWebView); the pre-registration is `preview-key`, the real descriptor is
  `actual-key`, and the mismatch aborts the runtime (the host is dead).

### Host-side actual descriptor verification (2026-10-18)

`install-preload-bridge` now carries the preview exposure metadata (apiKey,
descriptor bytes, function count, SHA-256). The native host compares the real
WKWebView descriptor against that metadata and replies `{ok:true/false}`; the
actual exposure is still stored/published so the Node pre-registration
comparison can abort a mismatch.

Gating the isolated hello/page on that host reply was attempted and reverted:
the reply is asynchronous, and both B6-C and B6-D timed out because the first
page script lost the API before the reply settled. The host verification is
therefore **post-hoc**, not an actual-before-page gate.

Limits that remain for B7:

- the preview is not the actual WKWebView descriptor; the page's first script
  can run before the Node receives the actual descriptor event. A same-key
  descriptor-only mismatch is detected after the page;
- the strict runtime must gate the **actual** descriptor before page calls
  with a synchronous pre-page admission (the async reply is insufficient) or
  the strict nodeless runtime; the host-side expected verification alone does
  not close this;
- the page-admission ordering is closed for the experimental M1 preview path
  only, not for the strict profile.

## Gate 2 — arbitrary API keys (closed in the experimental M1 transport; strict runtime port open)

The candidate page shim originally hard-coded the `fixture` key. The key must
be known before the first page script to define `window.<key>`. The current
experimental M1 transport now resolves this with a preload key preview; the
strict nodeless runtime still needs the same or an equivalent mechanism.

Three 2026-10-18 experiments were attempted and then reverted:

1. **Document-start `<meta>` marker**: the isolated preload publishes the
   non-secret key in a meta element; the host adds the preload user script
   before the page shim; the page shim reads the meta at document start and
   materializes the key. The B6-C and B6-D tests both timed out: the page shim
   did not obtain the key (document-start DOM availability and/or content-world
   script ordering).
2. **Document-comment marker + microtask retry**: the preload appends a
   document comment when the document element is not yet available; the page
   shim reads the comment and retries in a microtask before the first body
   script. The same B6-C/B6-D timeouts occurred; reverted.
3. **Window-prototype proxy**: install a Proxy above `Window.prototype` so
   the first unknown global access drives the hello, learns the key and
   defines it. WebKit rejected both `Object.setPrototypeOf(window, proxy)` and
   `Object.setPrototypeOf(Window.prototype, proxy)` ("window prototype cannot
   be replaced"/"cannot be extended"); `window.<key>` stayed undefined and the
   probe page reported the error. Reverted.

Conclusion for the page-shim-only approaches: the page global cannot be
proxied in WebKit, and the key is not available to the page shim before the
first page script. A different mechanism is required.

### Resolved path in the experimental M1 transport (2026-10-18)

The Node runtime previews the unchanged preload in a disposable `node:vm`
context with a `contextBridge` facade before navigation. It records exactly
one exposed key, passes it through the trusted `install-preload-bridge`
control op, and the native host injects it into the host-owned page shim before
the first page script. The real WKWebView preload still runs unchanged; the
signed hello verifies that the actual descriptor's `apiKey` equals the preview
key, so a dynamic/different preload fails closed.

Evidence:

- `tests/context-bridge-preload-key.test.cjs` covers the oracle (`fixture`),
  the edge fixture (`edge`), computed/custom keys, reserved/empty/oversize
  keys, missing/multiple exposures, unsupported modules and failing preloads;
- the B6-C oracle test uses `fixture` and the B6-D edge test uses `edge`, both
  through the preview → host → page shim path;
- `npm test` is 452 pass; the default and B6-B paths remain green.

Limits of this path:

- one exposed key, deterministic/synchronous at preload load;
- the preview executes the trusted preload in a VM with stubs; top-level side
  effects are stubbed, local modules are unsupported, and the real preload
  runs again in WebKit (double execution must be reviewed);
- the strict `electron-nodeless-v1` runtime is QuickJS/native and has no Node
  `vm`; the preview must be ported to the strict runtime;
- this does **not** solve page-admission ordering: the page API still
  materializes before the MoonBit exposure registration.

Arbitrary keys are therefore closed for the **experimental M1 transport**,
not for the strict profile.

## Gate 3 — full preload environment (open)

The candidate exposes only `contextBridge.exposeInMainWorld`, the test-only
`ipcRenderer.send` report lane and a fail-closed `webUtils`. Missing:
`ipcRenderer.invoke/on/removeListener/sendSync`, `webUtils` behavior,
Node-free preload globals/module resolution, arbitrary preload source, and
the full first-script/failure taxonomy.

## Gate 4 — frames, self-DoS and faults (partially characterized; Electron-compatible child frames open)

The experimental M1 host's navigation policy cancels every subframe
navigation, so the host is currently **main-frame-only**. The frame test
(`tests/context-bridge-frames-native.test.cjs`) verifies that a same-origin
child frame and a sandboxed `allow-scripts` child frame are both absent, that
the parent's API still works, and that the parent page cannot see the
preload/native transport handlers. No child frame can receive or reach the
bridge.

This is **stricter than Electron**, which can host child frames; it is not an
Electron-compatible frame policy. The child-frame compatibility decision and
same-origin/cross-origin/sandboxed behavior remain open.

### Page self-DoS (2026-10-18)

`tests/context-bridge-self-dos-native.test.cjs` loads a page whose first
script busy-loops forever. After 500 ms the load is still in flight
(`window._loading === true`), but the native title and preload-status requests
both answer (`preloadStatus: "ok"`; the title is empty because the page never
finishes parsing). The native control lane is therefore not blocked by page
JavaScript. This is one bounded self-DoS observation, not a CPU/memory
exhaustion or full fault-injection matrix.

## Gate 5 — strict runtime and evidence (open)

B7 must provide the strict runtime implementation and evidence:

1. the unchanged preload/page under the strict nodeless runtime;
2. first-script synchronous return/throw and isolation;
3. callback/Promise/error semantics and arbitrary keys;
4. page-admission ordering and the authority decision;
5. frame policy and page self-DoS behavior;
6. exact environment/source hashes, raw evidence and reproducible commands;
7. the independent/agreed security review and the profile-gate decision.

Only then may `electron-nodeless-v1` change from blocked. The strict profile
gate is not changed by the B6 acceptance or this plan.

## Next work

1. Decide the strict runtime architecture: nodeless QuickJS with the MoonBit
   core in-process vs a different reviewed admission mechanism.
2. Prototype the page key/admission in that architecture, not by extending
   the `fixture`-only page shim.
3. Port the accepted transport and the full preload surface.
4. Add frame/self-DoS/fault evidence and the strict-profile E2E.
5. Re-run the B6-E baseline/review packet against the strict runtime and
   request the B7 gate decision.

The B7 goal remains active; the strict profile stays blocked until the gates
above are closed with runtime evidence. The next concrete work is a
synchronous actual-before-page admission (the host reply is asynchronous),
Electron-compatible child frames, a broader self-DoS/CPU/memory fault matrix,
then porting the preview/admission path to the strict nodeless runtime and the
full preload.
