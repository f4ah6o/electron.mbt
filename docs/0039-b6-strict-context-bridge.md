# B6 strict contextBridge — production design and pre-registration

Status: **B6 design; B6-A exposure authority, B6-B experimental preload
environment, the B6-C experimental synchronous transport E2E and the B6-D
experimental semantic-closure matrix are implemented; B6-E evidence and the
security-review packet are prepared, and the B6-C/B6-D transport candidate
was accepted by the project owner on 2026-10-18 for B7 design work. Production
`contextBridge` remains `NOT_IMPLEMENTED`; M0 OPEN; strict profile blocked
pending the B7 runtime and security gates.** B5 recorded a
test-only `go` on one macOS/WebKit build ([docs/0038](0038-m0-context-bridge-spike.md)).
B6 is the production implementation and evidence phase. This document is not
an adoption decision for the B5 transport and does not authorize the original
preload, ordinary `run`/`pack` or any compatibility row.

## Input from B5

B5 demonstrated, on macOS 26.5.2 / WebKit `21624.2.5.11.8`, that an
**unchanged** `fixtures/oracle/preload.cjs` can be exposed through a test-only
shared-DOM synchronous candidate with HMAC response integrity, callbacks,
nested/reentrant calls, Promises, frozen copies, a sandboxed-child negative and
navigation/stale-grant revocation. The unchanged oracle observation matched
the pinned Electron 44.7.0 validator; the Electron baseline differential was
not run locally.

B5 does **not** establish any of the following, so B6 must not infer them:

- that the shared-DOM/HMAC transport is production-safe or reviewed;
- that the test-only CJS wrapper is Electron's sandboxed preload environment;
- that arbitrary preload source, Node globals, `ipcRenderer` channels, frame
  policy, origin/document authority or value types work;
- that the original Moji/app preload can run or that M0 is closed.

## Authority split

| Owner | Owns | Must not own |
| --- | --- | --- |
| MoonBit `core` | window/document generations, document authority, exposure IDs and quota, handle IDs/quotas, release/revocation, request terminal state, diagnostics | JS function bodies, DOM/native objects |
| Native host | actual `WKScriptMessage` frame/document, navigation policy, per-document grants, source integrity, isolated/page content worlds, OS objects | renderer-supplied sender/origin claims |
| Isolated preload realm | the unchanged preload's closures, `module.exports`, restricted `require('electron')` | independent grant issuance, page-world privilege |
| JS leaf | actual function/callback/Promise identity in the source realm, page wrappers, descriptor materialization | a second policy/ID/quota state machine |
| Page world | copied/frozen values, callable proxies, DOM/UI | arbitrary privileged preload objects, control-lane operations |

The B5 JS registries are test-only. B6 must move exposure key/descriptor
registration, handle lifetime, quotas and document revocation into MoonBit
(`core/context_bridge.mbt` and the private trusted-host dispatch), with the JS
leaf holding only the actual functions and identity. The first slice
implements the exposure authority; it does not yet wire a production
transport.

## Production transport decision (not adopted yet)

B5's repaired shared-DOM/HMAC candidate is an input, not an accepted
production mechanism. Before B6 can use it, the implementation must:

1. replace or justify the test-only hand-written HMAC and source-injected
   secret with a reviewed primitive or an equivalent engine-level mechanism;
2. define and test the same-origin iframe, child-frame and page self-DoS
   boundaries;
3. show response integrity and error/throw behavior against the pinned
   Electron fixture;
4. survive an independent security review of the shared-DOM trust model.

If public WebKit still cannot satisfy these conditions, the production
transport remains blocked and the adapted profile continues. No private
WebKit selector, page-world preload, disabled isolation/sandbox or hidden
Electron/CEF fallback is permitted.

## Delivery phases

### B6-A — exposure authority (implemented 2026-10-18)

MoonBit owns:

- exposure IDs (monotonic, never reused), API-key validation and reserved
  names, descriptor byte length and SHA-256, declared function count;
- duplicate-key rejection per document, per-document and runtime quotas;
- authority checks (app/window/document/origin/main-frame/channel) before
  allocating anything;
- release, navigate/invalidate/destroy/stop revocation and close/quit
  cancellation semantics;
- the private trusted-host dispatch operations `expose` and
  `release-exposure`, with exact flat scalar fields and fail-closed parsing.

No page-world API, preload loader, native host change or transport is added by
B6-A. The original preload stays `NOT_EXECUTED`.

Implemented in `core/context_bridge.mbt`, `core/runtime.mbt`,
`bridge/context_bridge.mbt` and `bridge/moon.pkg`:

- `Runtime` now owns bounded `BridgeExposure` records and a monotonic exposure
  ID space; stop/destroy/navigate/invalidate revoke them with handles.
- API keys are bounded to 1..64 printable characters with reserved names
  rejected; descriptor byte length (1..65536), declared function count (0..256)
  and a 64-hex descriptor SHA-256 are validated before allocation.
- Duplicate keys per document are denied; quotas are 32 per document and 128
  per runtime; release is idempotent; IDs are never reused.
- The private trusted-host dispatch accepts `expose` and `release-exposure`
  with exact flat fields only; renderer-supplied metadata is not an endpoint
  and no page API is created.
- Tests: MoonBit JS 141 pass, native 160 pass; portable Node
  `tests/context-bridge-exposure.test.cjs` 4 pass; full `npm test` 447 pass.
  These are contract tests, not compatibility evidence.

B6-A does not implement a transport, page shim, preload loader, native host
integration or security review. The strict profile stays blocked and the
original preload stays `NOT_EXECUTED`.

### B6-B — preload environment (experimental slice implemented 2026-10-18)

The existing M1 loader already provides app-root containment, canonical path,
symlink escape rejection, UTF-8/64 KiB bounds and SHA-256 re-verification.
B6-B adds an **opt-in** preload bridge environment behind
`ELECTRON_MBT_B6_PRELOAD_BRIDGE=1`:

- `require('electron')` returns a bounded `contextBridge.exposeInMainWorld`
  plus `ipcRenderer`/`webUtils` that fail closed if called.
- `exposeInMainWorld` records a bounded descriptor (API key, top-level
  function handles/arities, copied plain data) in the preload realm and posts
  only bounded metadata to the native host. The descriptor body stays in the
  native host; Node/MoonBit receives API key, descriptor bytes, function count
  and SHA-256.
- The native host publishes a `preload-exposure` event only after the
  independent bootstrap/preload attestation; `ExperimentalRuntime` registers
  the exposure through the MoonBit B6-A authority using the trusted bootstrap
  scope.
- The default (env unset) preload remains the restricted fail-closed profile.
  The page API is **not** materialized; `ipcRenderer`, Node globals and the
  general preload module environment remain unsupported.

Evidence: `tests/context-bridge-preload-bridge-native.test.cjs` runs the
unchanged oracle preload bytes (same SHA-256 as
`fixtures/oracle/preload.cjs`), observes preload status `ok`, the native
exposure event and MoonBit registration, same-url reload revocation, no page
`window.fixture`, hidden native handlers and preserved source hashes. The
transport protocol now validates the exact `preload-exposure` metadata shape
and rejects replayed/malformed events.

Remaining B6-B scope: `ipcRenderer` invoke/on/removeListener, `webUtils`,
Node-free preload globals/module resolution, arbitrary preload source,
full first-script/page ordering and the production profile enablement. These
are not met by this slice.

- Production source loader: app-root containment, canonical path, symlink
  escape rejection, UTF-8/64 KiB bounds, SHA-256 re-verification (existing).
- Restricted `require('electron')`/CJS execution in the isolated preload
  realm, with explicit unsupported-module failures and no silent empty
  modules (partially implemented; see above).
- Unchanged preload source; first-script ordering; preload failure taxonomy
  (unchanged source and status path tested; full environment open).

### B6-C — native authority and transport (experimental E2E implemented 2026-10-18)

The B5 transport is an **opt-in experimental** B6-C integration, not a
production default. The independent transport review remains a prerequisite
for strict promotion.

Implemented slice:

1. Add host-owned candidate sources under `bridges/preload/` (codec,
   page-shim, isolated bridge), adapted from the tested B5 sources with the
   exposure-metadata and preload-status hooks. The app cannot supply these
   sources.
2. Add an `install-preload-bridge` trusted-host control op. The Node runtime
   reads the candidate sources, passes bounded source bytes plus SHA-256 to
   the native host before `load-file`; the host re-verifies and stores them.
3. In `installBootstrapScript`, when the transport is installed, generate a
   per-document secret and inject:
   - the page shim in `pageWorld` at document start;
   - the isolated bridge + codec + unchanged CJS preload wrapper in the
     preload world at document start.
   The preload status and exposure metadata continue through the existing
   `preload-result` / `preload-exposure` lanes.
4. Register native `electronMbtM0CbDocument` / `electronMbtM0CbReport`
   handlers in the preload world. The document handler returns a per-document
   grant only to the isolated main frame; the report handler checks the real
   frame/URL/generation/grant and publishes a bounded `preload-report` event.
5. Extend the transport protocol with the exact `install-preload-bridge`
   request and `preload-report` event shapes. `preload-report` is evidence/
   fixture transport only; it is not production IPC.
6. Add a macOS-only E2E with the unchanged oracle preload **and** oracle page
   copies: first-script sync return/throw, callbacks, nested/reentrant calls,
   Promise, frozen copies, the report observation through the pinned
   validator, same-url reload/revocation, source hashes and no page-visible
   native handlers.
7. Keep `ELECTRON_MBT_B6_TRANSPORT=1` plus the B6-B preload flag opt-in; the
   default preload, strict profile, M0 and `compatible:false` stay unchanged.

The slice is covered by `tests/context-bridge-transport-native.test.cjs`:
the unchanged oracle preload and page copies run in the M1 host, the page's
first script gets synchronous `42`/throw, Promise fulfillment/rejection,
callbacks, frozen copies and isolated primordials, the same pinned validator
passes for the initial and reloaded documents, the exposure is registered and
revoked, source hashes are preserved, and the page cannot see native handlers.
The transport sources are `bridges/preload/{codec,page-shim,isolated-bridge}.js`.
The native `preload-report` lane is evidence/fixture transport only.

Known B6-C limits (strict remains blocked):

- the page API materializes from the native-attested preload descriptor
  before the MoonBit exposure metadata registration settles; making that
  registration part of admission is B6-D work;
- the hand-written HMAC/shared-DOM transport has not received the independent
  security review required for strict promotion;
- `ipcRenderer` exposes only the bounded test report lane; invoke/on/
  removeListener, webUtils, full Node-free preload globals and arbitrary
  preload source remain unsupported;
- arbitrary page API keys, same-origin iframe policy, page self-DoS, the full
  fault-injection matrix and B7 evidence remain open; B6-D/E cover the broad
  semantics matrix and the review packet.

- Per-document isolated bootstrap/attestation and sender/frame/document
  binding.
- Reviewed synchronous page<->preload transport and response integrity.
- Page-world exposure materialization, callbacks/Promises/errors, bounded
  values, revocation on navigation/termination/host loss.
- Frame policy for same-origin/cross-origin/sandboxed children.

### B6-D — semantic closure (experimental matrix implemented 2026-10-18)

`tests/context-bridge-semantics-native.test.cjs` drives the production
transport with `fixtures/b6-preload-app/edge-preload.cjs` and `edge.html`.
It covers primitives/null/arrays/plain objects, undefined return, returned
functions, thrown/returned errors, frozen data and primordial isolation; 15
unsupported arguments and 13 unsupported returns (undefined argument, Date,
Map, Set, typed array, NaN, Infinity, BigInt, Symbol, cycles, accessors,
symbol keys, sparse arrays, oversized strings, excessive depth); callback
add/fire/remove identity, disposers, nested/reentrant calls, callback
functions, callback throws and callback Promises; Promise fulfillment,
rejection, unsupported settlement, thenables and double settlement; and a
same-url reload with fresh observation, exposure revocation and source-hash
preservation.

Three transport defects were found and fixed:

- symbol-keyed properties were silently dropped; they are now rejected with
  `ELECTRON_MBT_BRIDGE_VALUE_SYMBOL`;
- sparse arrays were silently converted to `undefined`; holes are now
  rejected with `ELECTRON_MBT_BRIDGE_VALUE_HOLE`;
- a synchronously-settling thenable could emit its settlement before the
  page decoded the promise handle; the page shim now buffers a bounded
  number (64) of early settlements and applies them when the promise handle
  is registered.

Still open: arbitrary page API keys (the candidate page shim materializes
the single `fixture` key), page-admission ordering, the independent HMAC/
shared-DOM review, same-origin iframe policy, page self-DoS, full
`ipcRenderer`/`webUtils`/preload globals and fault injection.

### B6-E — evidence and review (packet prepared; review NOT RUN)

The unchanged-oracle B6-C test now compares its normalized observation with
`evidence/electron-baseline.json` when present, and
`ELECTRON_MBT_REQUIRE_ORACLE_BASELINE=1` makes a missing baseline fail. The
macOS CI runs this after the pinned Electron baseline and M0 spike and also
records the B6-D semantics run:
`evidence/b6-context-bridge-transport.log` and
`evidence/b6-context-bridge-semantics.log`.

The exact environment, commands, local PASS/NOT RUN table, threat model,
controls/residual risks and reviewer checklist are in
[docs/0040](0040-b6-d-e-evidence.md). The project owner accepted the transport
for B7 design work on 2026-10-18; no external independent audit was
performed. Strict profile admission remains B7 and is blocked on the
page-admission ordering, arbitrary API keys, full preload globals/
ipcRenderer/webUtils, frame policy, page self-DoS and the B7 runtime evidence;
no acceptance row is promoted by B6-A/B/C/D/E alone.

## B6 acceptance criteria (not met by B6-A)

- The unchanged preload's first page script observes synchronous return and
  throw, not a Promise.
- Page response forgery fails; the reply/error cannot be fabricated or
  replayed across documents.
- Callbacks, disposers, nested/reentrant calls, Promise fulfillment/rejection
  and Error realm evidence match the pinned Electron observation.
- Exposed data is copied and frozen; page prototype/global tampering does not
  affect the isolated preload's primordials or authority.
- A page/frame cannot invoke unexposed functions or acquire the native
  handler/grant; child frames fail closed.
- Navigation/reload/termination revoke exposures, handles, callbacks and
  pending work exactly once; stale IDs fail closed.
- Every payload/handle/queue is bounded; unsupported values fail with a typed
  error and never hang or silently degrade.
- Source/asset hashes are preserved; no hidden Electron/Chromium, no
  page-world preload, no disabled isolation/security.
- The same fixture passes under the pinned Electron oracle on the recorded
  environment, with an independent review.

## B6-A acceptance (met 2026-10-18)

- MoonBit `core` exposes bounded exposure registration/validation/release,
  quotas, duplicate-key rejection and lifecycle revocation with deterministic
  tests on JS and native targets.
- The private `context_bridge_dispatch` accepts only the exact `expose` /
  `release-exposure` shapes and remains a trusted-host metadata boundary, not
  a renderer endpoint.
- Portable Node tests drive the compiled dispatch fail-closed cases.
- No production transport, preload execution, `run`/`pack` enablement,
  compatibility row, manifest promotion or M0 closure.
- Strict profile remains **blocked**; original preload remains
  **NOT_EXECUTED**; `compatible:false` and M0 OPEN remain.

## Non-goals

- Closing M0 or declaring strict `contextBridge` compatible in B6-A.
- Running the original preload or enabling ordinary `run`/`pack`.
- Changing the adapted profile or any app record.
- Windows/Linux, packaging, size/performance, IME/AX, real-app acceptance.
- Treating the B5 test-only JS registry, HMAC or CJS wrapper as production
  authority.

## Open questions / risks

- Which reviewed response-integrity primitive replaces the test-only HMAC?
- How much of the shared DOM's reach can a same-origin child frame exercise?
- Can synchronous callbacks and Error identity be preserved without a page
  self-DoS that the app must handle?
- How will the production leaf prove function/closure identity without
  duplicating MoonBit quota/policy state?
- What is the exact fallback if the reviewed transport is not achievable with
  public WebKit? (Keep strict blocked; continue adapted.)

## References

- [B5 spike results](0038-m0-context-bridge-spike.md)
- [M0 feasibility report](0003-m0-contextbridge-feasibility.md)
- [Issue 0007 strict feasibility and security](../issues/polished/0007-context-bridge-feasibility-and-security.md)
- [Issue 0001 §6.2 and §16](../issues/polished/0001-electron-compatible-lightweight-runtime.md)
- [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)
