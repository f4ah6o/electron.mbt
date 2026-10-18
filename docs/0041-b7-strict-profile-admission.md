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

## Gate 2 — arbitrary API keys (open; two experiments failed)

The candidate page shim hard-codes the `fixture` key. The isolated bridge's
descriptor carries the actual `apiKey`, but the page shim needs the key
before the first page script to define `window.<key>`.

Two 2026-10-18 experiments were attempted and then reverted:

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

Conclusion: arbitrary keys are an architectural limit of the current
shared-DOM/lazy page shim, not a small patch. B7 needs an engine-level bridge,
a predeclared-key contract (which would change the app/page contract), a
preflight document, or another reviewed mechanism. The working candidate
remains `fixture`-only and is not a strict-profile API surface.

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
above are closed with runtime evidence.
