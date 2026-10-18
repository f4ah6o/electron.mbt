# B6-D/B6-E — experimental semantics, evidence and security-review packet

Status: **experimental evidence only.** This document does not promote the
strict profile, does not authorize the original preload, and does not claim
Electron compatibility. `compatible:false`, `contextBridge:NOT_IMPLEMENTED`,
strict **blocked**, M0 **OPEN** and the original preload **NOT_EXECUTED** are
unchanged. The independent security review has **not** been performed.

## B6-D — semantic closure (experimental, implemented 2026-10-18)

`tests/context-bridge-semantics-native.test.cjs` runs the opt-in production
transport with `fixtures/b6-preload-app/edge-preload.cjs` and `edge.html`.
It covers, in one document plus a reload:

- primitives, null, arrays, plain objects, undefined return, a returned
  function, thrown/returned errors (name, message, page-realm `Error`);
- frozen exposed data and isolated primordials;
- 15 unsupported arguments and 13 unsupported returns: `undefined` argument,
  Date, Map, Set, typed array, NaN, Infinity, BigInt, Symbol, cycles,
  accessors, symbol keys, sparse arrays, oversized strings, excessive depth;
- callbacks: add/fire/remove identity (removal by original identity fails),
  disposer once/twice, nested/reentrant callback, callback returning a
  function, callback throwing and a callback returning a Promise;
- Promises: fulfillment, rejection, unsupported fulfillment value, native
  thenable, and a thenable that settles twice;
- same-url reload: fresh observation, exposure revocation, source hash.

### Defects found and fixed

1. **Symbol-keyed properties were silently dropped.** `codec.js` now rejects
   them with `ELECTRON_MBT_BRIDGE_VALUE_SYMBOL` instead of producing a
   lossy page copy.
2. **Sparse arrays were silently converted to `undefined`.** `codec.js` now
   rejects holes with `ELECTRON_MBT_BRIDGE_VALUE_HOLE`.
3. **Synchronous thenable settlement raced the reply.** A custom thenable can
   call `then(resolve)` synchronously; its settlement event could reach the
   page shim before the reply carrying the promise handle was decoded, so the
   page Promise never settled. The page shim now buffers a bounded number of
   early settlements (64) and applies them when `makePagePromise` registers
   the handle. The isolated bridge's native settlement path is unchanged.

Files: `bridges/preload/codec.js`, `bridges/preload/page-shim.js`,
`fixtures/b6-preload-app/edge-preload.cjs`, `edge.html`,
`tests/context-bridge-semantics-native.test.cjs`.

## B6-E — differential and evidence

`tests/context-bridge-transport-native.test.cjs` still runs the unchanged
oracle preload/page and now compares its normalized observation to
`evidence/electron-baseline.json` when that baseline exists. With
`ELECTRON_MBT_REQUIRE_ORACLE_BASELINE=1` the test fails if the baseline is
missing. The macOS CI step runs this after the pinned Electron baseline and
the M0 spike, and runs the B6-D semantics test:

```
ELECTRON_MBT_REQUIRE_ORACLE_BASELINE=1 \
  node --test tests/context-bridge-transport-native.test.cjs 2>&1 | \
  tee evidence/b6-context-bridge-transport.log
node --test tests/context-bridge-semantics-native.test.cjs 2>&1 | \
  tee evidence/b6-context-bridge-semantics.log
```

Pinned reference: Electron `44.7.0` (CI). Recorded B5 runtime environment:
macOS 26.5.2, WebKit `21624.2.5.11.8`, Node 24.22.0. The B6-C/B6-D tests run
on the real WKWebView host; no Electron bundle, static scan or Linux run is
substituted.

Local 2026-10-18 evidence:

| Check | Result |
| --- | --- |
| B6-C unchanged oracle transport | PASS |
| B6-D semantics matrix | PASS (`15` unsupported args, `13` unsupported returns) |
| B6-C baseline comparison | NOT RUN locally: no `evidence/electron-baseline.json`; CI requires it |
| `moon test --target js` | 143 pass |
| `moon test --target native` | 162 pass |
| `npm test` | 450 pass (macOS) |
| `verify-state` | 17/17, `NOT_READY` expected |
| Independent security review | NOT RUN |
| Original preload | NOT EXECUTED |

## Security-review packet

This is a review request, not a review result. The reviewer should challenge
the threat model and the residual risks below.

### Assets and trust boundaries

- Untrusted page realm; trusted app preload; host-owned bridge source; native
  WKWebView host; trusted Node runner/MoonBit authority; private control
  channel.
- Assets: per-document secret, document grant, exposure descriptor, native
  event/control channel, page callable handles, Promise/callback ledgers.

### Threats and current controls

| Threat | Control | Evidence |
| --- | --- | --- |
| Page forges a request/descriptor/settlement | HMAC over session/kind/id/payload, per-document secret, challenge/session id | B5 codec vectors, B6-C test, B6-D |
| Replay or cross-document reuse | Per-document secret/grant, generation, session id, one-shot hello, bounded handles | B6-C reload/revocation |
| Page steals the secret/grant | Secret in closure/user-script source; grant only returned to the isolated main frame; no page native handler | B6-B/B6-C tests |
| App substitutes bridge source | Host-owned `bridges/preload/` sources; trusted install op; source length/SHA-256 re-check | `install-preload-bridge` |
| Child frame impersonates the document | Main-frame-only user scripts/handlers; real `frameInfo`/URL/generation checks | Existing B6 tests; child policy remains open |
| Unbounded values/queues/pending work | Codec byte/depth/node/string/handle limits, wire limits, bounded callbacks/promises/early settlements | B6-D bounds cases |
| Lossy coercion changes values silently | Symbol keys and sparse arrays now rejected; non-finite/typed/Date/Map/Set/accessors rejected | B6-D fixes |
| Synchronous settlement loses a Promise | Bounded early-settlement buffer | B6-D thenable double |
| Report lane becomes IPC | Report lane is test-only evidence; grant/frame/URL/generation checked; no OS or main-process action | B6-C test |
| Page self-DoS/freeze | Page owns its event loop; synchronous transport is bounded; native host not blocked on page JS | Not independently tested; open |
| Page API admitted before MoonBit registration | **OPEN**: page materialization precedes the exposure registration; strict gate requires admission ordering | Documented B6-C/B6-D blocker |
| Custom HMAC/shared-DOM transport | **OPEN**: no independent primitive/protocol review | Review required |
| Arbitrary `exposeInMainWorld` key | **OPEN**: candidate page shim materializes the single `fixture` key | B6-D fixture uses `fixture` |
| Full preload environment | **OPEN**: only `contextBridge`, a test report `send`, and fail-closed `webUtils`; invoke/on/removeListener, Node globals, arbitrary preload source | Documented |

### Reviewer checklist

1. Is the per-document secret/grant lifecycle sufficient against replay and
   stale-document events?
2. Does the early-settlement buffer have a bounded, non-dangling handle map?
3. Can the page cause unbounded native work through calls, callbacks,
   Promises, errors, or the report lane?
4. Is the HMAC construction and shared-DOM transport acceptable, or must it
   be replaced with an engine-level proxy/another primitive?
5. How must the MoonBit exposure registration become part of page admission
   before strict promotion?
6. What is the required same-origin iframe/child-frame policy and page
   self-DoS behavior?
7. Are the source-integrity and install-op checks sufficient for the
   trusted-runner boundary?

## Decision requested

Accept, reject or replace the B6-C/B6-D experimental transport for B6-E/B7.
Until that decision and the independent review, the strict profile stays
blocked and no acceptance row is promoted.
