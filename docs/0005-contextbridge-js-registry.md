# contextBridge: compiled authority and host-local JS registry

Status: **partial prerequisite**, continuing PR #10. This is executable lifetime
integration, not an implementation of Electron's cross-world `contextBridge`.
M0 OPEN, `compatible:false`, row C planned and ordinary `run`/`pack` fail-closed
remain unchanged. The experimental M1 CLI now constructs `context-runtime.cjs`,
which preserves the existing session and attaches the new registry to its core.

## Implemented

1. `context_bridge_dispatch` is a private trusted-host metadata boundary into
   the real MoonBit Runtime. It validates exact operation-specific fields,
   scalar-only JSON, a 2,048-string-unit bound, bounded origin/channel strings,
   Boolean frame status, and typed handles. IDs use canonical positive decimal
   **strings** up to signed Int max; fractions, exponents, leading zeroes and
   JSON numbers are rejected before any JS Int conversion or Double rounding.
   Activate/grant are host policy operations, never renderer IPC endpoints.
2. The JS leaf stores actual function/callback references and Promise resolver
   pairs by MoonBit-issued ID. It checks MoonBit authority on use, release and
   settlement. Repeated function registrations receive distinct IDs; this does
   not assert Electron inter-call callback identity. Calls are synchronous,
   including throws, and revalidate after user-function reentry before returning.
3. Promise settlement validates/copies its data before consuming the MoonBit
   record, then drops the JS record before resolve/reject. Callable thenables,
   getters and proxies are rejected without execution. Explicit Promise release
   and document revocation reject the returned Promise with
   `ELECTRON_MBT_BRIDGE_REVOKED`. A no-op internal catch prevents revocation before
   caller subscription from producing an unhandled rejection; callers still see
   rejection on the original Promise.
4. The bound core reconciles its JS registry after dispatch, navigation,
   invalidation and destruction, before the existing session emits lifecycle
   events. Cleanup consults actual MoonBit record existence, **not authorization
   failure**: closing/quitting denies use but cancelling it preserves records.
   Failed stale transitions do not reclaim live entries. All removed records
   are detached before Promise rejection. Other windows retain their entries.
5. The registry has no second set of policy/ID/quota state machines: MoonBit's
   existing 256-per-document / 4,096-per-Runtime limits and monotonic IDs govern
   retention. A WeakMap scopes registry ownership to each Runtime. Calls through
   the raw unbound core require an explicit `reconcile()` to promptly reject
   pending Promises; the M1 CLI uses the bound core automatically. Cleanup counts
   measure removal of registry references, not proof of garbage collection or
   cancellation of work already running inside a source function.

## Narrow value and security boundary

This leaf runs in trusted **Node main**, not in WKContentWorld/page JavaScript.
Arguments and successful synchronous results use the existing bounded tiny-JSON
codec, plus undefined for a top-level return/settlement. Settlements take JSON
values as fulfillment/rejection payloads. Source-function throws stay in their
same realm. Returning a Promise or function from `invoke` is explicitly rejected;
transport-owned Promise slots use `createPromise`/`settlePromise` instead. This
is not Electron's full parameter/Error/Promise/function transfer contract and
must not be described as unchanged-preload compatibility or frozen exposure.

No new `window` object API, script message handler, page-world preload, DOM event
transport or IPC channel is installed. `context_bridge_retained` is an internal
cleanup query only; it cannot authorize a call. The metadata's host origin and
frame flag must come from a future validated native sender path. A caller that
fabricates them remains untrusted even when its JSON passes validation. Trusted
Node main and its primordials are not an untrusted-code sandbox.

Remaining: authenticated native sender/frame/document binding, a sandboxed
preload loader, synchronous cross-world transport, source/target realm proxies,
callback marshalling, full Promise/error transfer and frozen exposure. Shared-DOM
reply forgery is not repaired by a registry or by a main-frame Boolean.

## Verification

- `moon test --target js` / `moon test --target native`: canonical ID parsing,
  bounded flat metadata, fail-closed dispatch and existing lifetime contracts.
- `node --test tests/context-bridge-registry.test.cjs`: actual compiled MoonBit,
  actual JS closures/Promises, authority/kind confusion, reentrant calls and
  navigation, release/settlement, cleanup, cancellation, quotas and runtime scope.
- `node --test tests/context-bridge-native.test.cjs`: on macOS, builds on the real
  host prepared by existing CI and performs load/reload/destroy plus a real
  SIGKILL of the native host. It asserts JS cleanup and rejects stale work while
  retaining unchanged fixture hashes. On other platforms it explicitly SKIPs
  (NOT RUN). Its scopes are installed by a trusted host test using acknowledged
  window/document and the native URL getter; no renderer initiation is measured.
- Existing M1 unchanged-CJS, native host, WKContentWorld and pinned Electron
  oracle tests remain intact. Their success does not close the contextBridge gate.

Actual commands, execution results and environment limits are recorded on the
Draft PR. Local syntax checks are not compilation or native acceptance.

Reference: [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge/)
and [prior lifetime contract](0004-contextbridge-handle-lifetime.md).
