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

## Gate 1 — page-admission ordering (open)

The M1 page shim materializes `window.<key>` from the native-attested
preload descriptor. The MoonBit exposure registration happens later, on the
Node side, after `preload-exposure` and the bootstrap/preload attestation.
The first page script is synchronous; the Node/MoonBit registration is
asynchronous, so the M1 host cannot make that registration the page gate
without a different architecture.

B7 needs one of:

- the MoonBit authority in-process in the strict runtime, so admission is
  decided before the page shim materializes; or
- a reviewed synchronous native admission token that the page shim requires;
  or
- a documented removal of the MoonBit exposure registration from the
  page-admission path, with the native attestation as the authority (a
  semantic change requiring review).

The current M1 host does none of these; this is the first hard B7 gate.

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

## Gate 4 — frames, self-DoS and faults (open)

No same-origin/cross-origin/sandboxed child-frame policy, child-frame
transport, page self-DoS characterization, or fault-injection matrix has
been accepted. The B6-C/B6-D tests are main-frame fixtures.

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
above are closed with runtime evidence. The next concrete work is porting the
preload key preview into the strict nodeless runtime and making the exposure
admission/registration part of the page path.
