# Adapted preload / generated page API (fixture)

Status: **fixture-only, EP-13 partial**. This is the third implemented slice of
`electron-nodeless-adapted-v1` preload adaptation. It does **not** run the Moji
preload, implement `contextBridge`/`ipcRenderer`, connect native application
ingress to Main or claim app compatibility.

## Contract

- [compatibility/adapted-preload-v1.json](compatibility/adapted-preload-v1.json)
  records the adapted profile, `originalPreload: NOT_EXECUTED`, the generated
  adapter path/hash, page-world document-start injection, the fixed topic and
  call tables, the bounded first-call queue, `semantics.ingress: "ABSENT"` and
  the test-triggered native event path.
- [scripts/adapted-preload-check.cjs](scripts/adapted-preload-check.cjs) rejects
  a mismatched profile or schema, a hash mismatch, an original preload, a
  non-page/document-start adapter, a topic/call/queue table that differs from
  the adapter manifest, a missing event path and unsupported bridge semantics.
- [scripts/adapted-adapter.cjs](scripts/adapted-adapter.cjs) deterministically
  generates the adapter from `fixtures/native-app/adapted/api.json` (schema 2).
- [scripts/adapted-api-check.cjs](scripts/adapted-api-check.cjs) executes the
  generated adapter in a Node `vm` page context with a test host and checks the
  page-local listener and queue contract.

## Generated page API

The fixture exposes a frozen `window.api` with:

- `version()` returning `adapted-fixture`;
- `onOpenDocument`, `onCloseRequest`, `onUpdateState` for the fixed topics
  `doc:open`, `app:request-close`, `update:state`;
- `getSettings()` and `getUpdateState(options)` as ingress-gated Promise calls.

Listener registration is synchronous and page-local. Each `onX` call creates a
separate record even for the same callback and returns an idempotent disposer.
Emission snapshots the listener list at start, so a listener added during
emission waits for the next emission and a listener removed during emission is
still called by the current snapshot. A throwing listener propagates and stops
the current emission. No callback or function body crosses into native code.

The queue snapshots arguments at call time with `JSON.stringify`, admits at most
`maxCalls` pending calls and `maxBytes` of snapshot text, and never evicts an
admitted call. Overflow rejects that call with
`ELECTRON_MBT_ADAPTER_QUEUE_FULL`. The ready deadline starts when the first call
waits, not at adapter installation. If that call is still queued after
`readyTimeoutMs`, admitted calls reject once with
`ELECTRON_MBT_ADAPTER_INGRESS_TIMEOUT`, the queue is cleared, and a late ready
signal cannot replay it. A later call rejects with
`ELECTRON_MBT_ADAPTER_INGRESS_UNAVAILABLE`. These are page-leaf pending
resolvers; native admission and revocation remain the authority.

In the native fixture the supervisor releases the queue explicitly with
`release-adapted-ingress` after the page reports `adapted-queue-pending`. The
four admitted calls reach the native ingress path and are dispatched to the
fixed QuickJS Main fixture; their results resolve the page. The three overflow
calls stay `QUEUE_FULL`. The page applies the Main settings and sets
`nodeless-app-ready`. The queue timeout path remains covered by the Node
contract harness. See [docs/0025-main-dispatch.md](0025-main-dispatch.md).

Local event delivery is independent of the RPC queue deadline. The native host
installs a host object at document-start that exposes only a nonce-bound page
dispatcher for the fixed topics; it does not signal `DocumentIngressReady`. The
adapter captures that host and deletes the handoff global before page scripts
run. The Node test host is still used for positive queue flush because no
application ingress is wired.

## Native execution

- `NativeHost.m` accepts `install-adapted-adapter` before the document load.
  The file is canonicalized under the app root, bounded to 65,536 bytes and
  required to be UTF-8.
- `installBootstrapScript` injects a native host script and then the pinned
  adapter body at document start in `WKContentWorld.pageWorld`, before the
  page's own scripts. The host defines a non-configurable
  `window.__electronMbtDispatch(nonce, topic, payload)` that throws on a wrong
  nonce and otherwise calls the adapter's page-local emitter. The nonce is
  lexical; page scripts can call the dispatcher but cannot read the nonce.
- The adapter wrapper separately reports `electronMbtAdapterInstalled` with a
  per-document nonce. Native accepts the receipt only from the current
  main-frame page-world document and records whether it arrived before
  `LoadComplete`. This is an installation observation, not a sender grant or
  ingress authorization.
- The private control lane exposes `dispatch-adapted-event` for the fixture. It
  accepts only the three fixed topics, a bounded value and the current
  generation; it requires an observed adapter installation and a completed
  load. It then evaluates the page-world dispatcher and returns a correlated
  `delivered` reply. It is a test trigger, not an application event route.
- A Moji-shaped adapted API is generated from the pinned preload contract:
  [fixtures/moji-adapted/page-api.js](fixtures/moji-adapted/page-api.js)
  exposes 14 IPC calls, 3 events and a typed unsupported `getDroppedPath`.
  The original preload remains `NOT_EXECUTED`; Moji main handlers are not
  connected. See [docs/0026-moji-adapted-api.md](0026-moji-adapted-api.md).
- A page-world `electronMbtApp` handler is registered with the adapter. It
  admits only `selftest:identity`, derives the sender from the actual
  `WKScriptMessage` frame/document/generation, ignores the payload's claimed
  sender and returns a typed admission reply. Unknown and oversized requests
  are denied. See [docs/0024-native-ingress.md](0024-native-ingress.md).
- Before load, the supervisor calls `prepare-source`; native verifies the
  fixture entry against `source-manifest.json`, copies it to a private staging
  directory and loads that snapshot instead of the working tree. The reload
  probe prepares a second snapshot. See
  [docs/0023-source-snapshot.md](0023-source-snapshot.md). The source manifest
  includes both the entry and the generated adapter; both are staged and the
  adapter install reads the staged copy.
- `fixtures/native-app/index.html` checks the page-local listener/disposer
  shape, rejects a forged page nonce and checks the queue timeout/overflow
  codes. The supervisor then delivers `doc:open` and verifies the page title
  changes to `adapted-event-native-delivery`.
- The supervisor explicitly loads generation 2, re-checks the adapter
  installation, bootstrap and absent-preload observations, and delivers
  `doc:open` again. The new document title becomes
  `adapted-event-native-reload`; the old generation cannot receive the event.
  Unknown topics and stale generations are rejected before any page effect.
- A fresh document realm starts with an empty listener table. The existing
  navigation policy still rejects an unrequested same-file reload; the reload
  probe uses an explicit `begin-load` and `load-file` for generation 2.

Observed fixture probe (macOS, AppKit + WKWebView):

```json
{"status":"PASS","probe":"native-supervisor-window-load","backend":"AppKit+WKWebView","windowLoaded":true,"adaptedAdapter":true,"pageApi":"adapted-fixture","pageTitle":"nodeless-app-ready","appScenario":"nodeless-fixture","bootstrapObserved":true,"preloadStatus":"absent","adapterDocumentStartBeforeLoad":true,"adapterIngress":"absent","adaptedEventDelivery":true,"adaptedEventReload":true,"adaptedEventUnknownTopicRejected":true,"adaptedEventStaleGenerationRejected":true,"adaptedEventForgedNonce":"page-observed-rejected","sourceSnapshot":true,"sourceSnapshotReload":true,"nativeIngress":true,"nativeIngressReload":true,"nativeIngressDenied":2,"nativeQueueRelease":true,"nativeQueueAdmitted":4,"nativeMainRoundTrip":true,"unsupportedBuiltinRejected":true,"mojiOperationRouted":true,"mojiHandlers":true,"fileBroker":true,"fileRead":true,"fileSave":true,"fileDenied":true,"fileDialog":true,"fileSaveAs":true,"exportHtml":true,"exportPng":true,"closeRequest":true,"closeRequestReload":true,"reloadGeneration":2,"compatible":false}
```

Adapter hash:
`49aeda61046df2110756c88dbf80a54564dc7d4382ab53a71c8129b88ae7728b`.

The contract harness reports 14 cases, 0 failed, including duplicate listener
records, emission snapshots, nested emission, listener throw, queue FIFO with
call-time argument snapshots, count/byte overflow, ready timeout with late-ready
rejection, single settlement, non-JSON argument rejection, fresh-realm
isolation and local events after the RPC queue deadline. It is a unit-level
check; the native probe is the real WebView evidence for the test-triggered
event path.

## Deliberate limits

- no original preload execution and no `contextBridge`/`ipcRenderer`
- no general application ingress, Main loader, invoke/reply or sender/document
  grant; the page-world ingress and queue release are test-only, and Main is a
  fixed QuickJS fixture graph
- the Moji adapted API is generated shape only; its original preload and main
  handlers are not run
- the file broker is partial: grants are test-only, dialog UI is NOT RUN, and
  document PDF/PNG rendering and `openLocalPath` are not implemented
  ([docs/0027-file-broker.md](0027-file-broker.md),
  [docs/0028-dialogs.md](0028-dialogs.md),
  [docs/0029-export.md](0029-export.md))
- the source snapshot covers the fixture entry, adapter, package metadata and
  preloaded module graph, but is not a signed or dynamically discovered app
  graph; the Main loader cannot require arbitrary files or builtins
- native event delivery is a private-lane test trigger; there is no production
  native event route, `webContents.send`, or Electron event-ordering evidence
- no `DocumentIngressReady` transition or native first-call flush; only the
  installation receipt, bounded timeout/overflow, fail-closed page API and the
  test-triggered event path are exercised on a real WKWebView
- event delivery is exercised after load; early native events and host-loss
  delivery are untested
- no Moji preload adaptation, no Moji app main or app scenario
- this is not `electron-nodeless-v1` strict compatibility and must not be
  admitted as strict evidence

## Next

- add document PDF/PNG rendering and exercise the real dialog/save panel UI,
  then boot Moji main/preload with the adapted API
- make the CJS loader dynamic over a verified graph and add the remaining Node
  symbol layers (EP-11/12); define the production `DocumentIngressReady`
  transition
- define and observe the actual `DocumentIngressReady` transitions separately
  from `LoadComplete` (EP-15)
- extend the entry+adapter source snapshot to the complete boot graph, with
  manifest provenance
- turn the test-triggered event path into a production fixed-topic route and
  test early events, host loss and listener exceptions natively
- generate adapters from Moji's actual preload API and connection graphs
- run Moji with the adapted profile and record app-scenario evidence
