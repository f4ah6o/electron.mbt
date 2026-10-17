# Native ingress / adapter queue (fixture)

Status: **fixture-only, EP-14 partial (C1 + C1c)**. A page-world request can
reach native, is bound to the actual WebKit frame/document/generation and is
admitted or denied before any application handler runs. The adapter's bounded
first-call queue is released into this path, but recognized application
recognized application operations are dispatched to the fixed QuickJS Main
fixture; there is no general app loader or Moji runtime.

## Contract

- `install-adapted-adapter` registers the page-world
  `electronMbtApp` script-message handler in addition to the installation
  receipt handler.
- The host object injected at document-start exposes `whenReady(callback)` and
  `dispatch(operation, argsJson)`. `dispatch` posts
  `{ operation, payload }` to `electronMbtApp`, maps the native error message to
  a typed `Error.code`, and returns the Promise.
- The page sends `{ operation, payload }` with exactly two members.
  `selftest:identity` is admitted. `app:get-settings` and
  `app:get-update-state` are forwarded to the QuickJS Main fixture over the
  `app-request`/`app-reply` lane; a missing Main lane rejects with
  `ELECTRON_MBT_MAIN_UNAVAILABLE`. The payload's `claimedSender` is never used
  as authority.
- `get-ingress-status` returns `admitted`, `denied`, `unhandled`, `lastCode`
  and `generation`.
- `release-adapted-ingress` is a private-lane test trigger that calls the
  page-defined `__electronMbtIngressReady()` and flushes the adapter queue.
  `trigger-adapted-ingress` calls `__electronMbtIngressProbe()` for the direct
  selftest.

## Native admission

Before any reply, native checks:

- the message arrived on the window's `WKUserContentController` and `WKWebView`;
- the content is alive, the generation is positive and equals
  `loadedGeneration`;
- `loadedFile` exists and the message's `frameInfo.request.URL` canonicalizes
  to the same file;
- the adapted adapter installation was observed for this generation;
- `message.world` is the page world and `frameInfo.isMainFrame` is true.

The request must have exactly `operation` and `payload`; unknown operations,
a non-dictionary payload, payloads with more than one value and strings longer
than 256 characters are denied with typed codes (`INGRESS_UNKNOWN_OPERATION`,
`INGRESS_MALFORMED`, `INGRESS_LIMIT`, `INGRESS_DENIED`). Application operations increment
`admitted` and are dispatched to the Main fixture; unknown or unavailable
operations still fail closed. The handler does not require `LoadComplete`, so
ingress observation is separate from the load outcome.

## Adapter queue release

The page sets `adapted-queue-pending`, then makes four calls that fit the queue
and three that overflow it. The supervisor observes the pending title, calls
`release-adapted-ingress`, and the host's `__electronMbtIngressReady` invokes
the adapter's stored flush callback. The four queued calls reach native and are
dispatched to the QuickJS Main fixture; their results resolve the page. The
three overflow calls reject with `ELECTRON_MBT_ADAPTER_QUEUE_FULL`. The page
then applies the Main settings and sets `nodeless-app-ready` as its title.

The same sequence runs after the generation-2 reload; native counters reset on
`begin-load`. The queue's own timeout path remains unit-tested by
`scripts/adapted-api-check.cjs`; the native fixture no longer uses the timeout
as its normal path.

## Evidence

The supervisor reports:

```json
{"nativeIngress":true,"nativeIngressReload":true,"nativeIngressDenied":2,"nativeQueueRelease":true,"nativeQueueAdmitted":4,"nativeMainRoundTrip":true}
```

The page probe verifies that:

- `selftest:identity` is admitted with a 64-character entry and manifest hash;
- the reply's sender is `native-wkwebview`, not the payload's
  `claimedSender: "forged-page"`;
- an unknown operation is rejected with
  `ELECTRON_MBT_INGRESS_UNKNOWN_OPERATION`;
- a 2048-character payload is rejected with `ELECTRON_MBT_INGRESS_LIMIT`.

The iframe/srcdoc non-main-frame negative is **NOT RUN**: in this WebKit the
page-world `electronMbtApp` handler was not exposed to the srcdoc subframe, so
the subframe could not reach native. The native `isMainFrame` check remains in
the admission path but is not exercised by that probe.

## Deliberate limits

- the Main/QuickJS side is a fixed fixture graph; no general loader, Node
  symbols or Moji main/preload
- no `contextBridge`/`ipcRenderer`, no production sender grant and no
  `DocumentIngressReady` state machine
- `release-adapted-ingress` is a test trigger; the page can call
  `__electronMbtIngressReady`, but each request is revalidated against the
  actual frame/document/generation
- the native fixture exercises queue release rather than the queue timeout;
  the timeout/overflow contract remains unit-level
- no iframe/srcdoc delivery evidence; the handler exposure itself is a separate
  policy question
- no origin/redirect/back-forward or opaque-origin policy
- `compatible:false`, adapted **partial** and strict **blocked** are unchanged

## Next

- move the Main fixture graph into the source snapshot and add the general CJS
  loader/Node symbol layers
- define the production `DocumentIngressReady` transition and remove the
  test-only release trigger
- decide the subframe/iframe handler policy and add executed negative tests
- add a close/lifecycle scenario and origin/redirect/back-forward cases
