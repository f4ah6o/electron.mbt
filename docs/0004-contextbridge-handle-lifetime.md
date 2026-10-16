# contextBridge handle lifetime — internal MoonBit contract

Status: **partial prerequisite, not a production contextBridge**. This increment
is stacked on Draft PR #2; it does not change main or enable `run` / `pack`.
`contextBridge:NOT_IMPLEMENTED`, M0 OPEN, `compatible:false`, and manifest row C
`planned` remain unchanged.

## Implemented boundary

MoonBit's existing `Runtime` now owns a bounded registry of function, callback,
and Promise proxy handles. JavaScript closures and function identity remain in
their source realm; the registry never stores function bodies or JS values.

1. Registration and every validation, disposal, or Promise settlement run the
   existing `Runtime::authorize` policy first. The native-observed window,
   document generation, origin, main-frame status and granted channel must agree.
   A handle is also bound to its exact window, generation, channel and kind.
   Handles are correlation IDs, **not secrets or bearer capabilities**.
2. IDs increase monotonically within a Runtime and are never recycled. The last
   signed 32-bit value is reserved to fail before overflow. Capacity is at most
   256 records per document and 4,096 across the Runtime, including all kinds.
   Explicit release frees capacity without making the released ID reusable.
3. `navigate`, `invalidate_document`, `destroy_window` and `stop` remove records
   at the same lifecycle boundary that revokes existing grants/pending work.
   Reactivating an invalidated document at the same generation cannot revive an
   old handle. Revoking one window does not remove another window's handles.
4. A valid release returns `true` once and `false` for an absent ID, but only
   after checking document/channel authority. Wrong-kind and foreign-handle
   release is denied. Promise settlement removes its record before the JS leaf
   may notify the target, so duplicate/reentrant settlement is rejected.
5. Closing/quitting temporarily denies use through the existing authorization
   policy. Cancelling close/quit preserves the live document's handles; final
   destroy/stop revokes them. A failed stale invalidation does not revoke the
   current document.

## Trust boundary and remaining implementation

The core receives **trusted host inputs**. It does not establish that those
inputs came from WebKit, authenticate an original page/frame initiator, or fix
page-forgeable DOM replies. Passing page-authored metadata to these methods
would not be secure. No new renderer-accessible endpoint or compiled CJS export
is added by this increment.

These are handle-lifetime policy methods, not real cross-world function proxies.
They do not implement `contextBridge.exposeInMainWorld`, synchronous calls,
frozen value copies, a sandboxed preload loader, JS callback identity, Promise
settlement delivery, or JS-heap cleanup. Pending JS callbacks/Promises must still
be detached/rejected by a future realm-local adapter when native lifecycle
revokes the document. The numeric registry's reclamation alone does not prove
that JS closures have been collected.

The next integration must bind native `WKFrameInfo` and document authority to
this policy, implement the source/target-realm leaf registries and their cleanup,
and demonstrate unchanged preload behavior with authenticated synchronous
return values. It must not expose this policy directly to a DOM/postMessage
caller or silently replace synchronous Electron APIs with Promises.

The pinned Electron oracle's callback observations remain authoritative. A
`CallbackProxy` tag is a lifetime category, not a claim that Electron preserves
identity across separate calls or that direct callback removal is supported.

## Validation

`core/context_bridge_wbtest.mbt` exercises the actual MoonBit Runtime with both
JS and native targets. The tests cover registration, authority, kind confusion,
release, one-shot Promise settlement, reload/invalidation/destroy/stop,
cancellation, document/runtime quotas, exhaustion and repeated revocation.
These are portable contract tests, **not WKWebView/contextBridge acceptance**.

Commands: `moon check --target js`, `moon test --target js`,
`moon test --target native`, `npm run build`, and `npm test`. The inherited full
macOS suite remains in CI. Report actual execution results on the Draft PR;
missing local toolchains or unexecuted native scenarios are NOT RUN, never PASS.

References: issue 0001 sections 4, 6.2 and 10; `0003-m0-contextbridge-feasibility.md`;
Electron's contextBridge API documentation.
