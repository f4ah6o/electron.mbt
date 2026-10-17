# Native ingress selftest (fixture)

Status: **fixture-only, EP-14 partial (C1)**. A page-world request can reach
native, is bound to the actual WebKit frame/document/generation and is admitted
or denied before any application handler runs. There is no Main/QuickJS
dispatch and no production application operation.

## Contract

- `install-adapted-adapter` registers the page-world
  `electronMbtApp` script-message handler in addition to the installation
  receipt handler.
- The page sends `{ operation, payload }`. Only `selftest:identity` is admitted
  in this slice. The payload may contain one bounded value; the page-supplied
  `claimedSender` is never used as authority.
- The admitted reply contains `admitted`, `operation`, `sender:
  "native-wkwebview"`, `mainFrame`, `generation`, `source`, `entrySHA256` and
  `manifestSHA256`. The hashes identify the prepared source snapshot.
- `get-ingress-status` returns the admission/denial counters and last denial
  code. `trigger-adapted-ingress` is a private-lane test trigger that calls the
  page-defined `__electronMbtIngressProbe` function.

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
`INGRESS_MALFORMED`, `INGRESS_LIMIT`, `INGRESS_DENIED`). The handler does not
require `LoadComplete`, so ingress observation is separate from the load
outcome.

## Evidence

The supervisor triggers the page probe after the load and again after the
generation-2 reload. It reports:

```json
{"nativeIngress":true,"nativeIngressReload":true,"nativeIngressDenied":2}
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

- one test-only operation (`selftest:identity`); no application method,
  invoke/reply, event reply or Main/QuickJS dispatch
- no `contextBridge`/`ipcRenderer`, no production sender grant and no
  `DocumentIngressReady` state machine
- no iframe/srcdoc delivery evidence; the handler exposure itself is a separate
  policy question
- no origin/redirect/back-forward or opaque-origin policy
- no Moji preload adaptation or app scenario
- `compatible:false`, adapted **partial** and strict **blocked** are unchanged

## Next

- dispatch admitted operations into the Main/QuickJS kernel and return the
  actual handler result
- connect the adapter's `getSettings`/`getUpdateState` queue to this ingress
  without conflating route readiness with `DocumentIngressReady`
- decide the subframe/iframe handler policy and add executed negative tests
- add origin/redirect/back-forward and sender/document lease cases
