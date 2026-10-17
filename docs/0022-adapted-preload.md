# Adapted preload / generated page API (fixture)

Status: **fixture-only, EP-13 partial**. This is the second implemented slice of
`electron-nodeless-adapted-v1` preload adaptation. It does **not** run the Moji
preload, implement `contextBridge`/`ipcRenderer`, connect native renderer
ingress or claim app compatibility.

## Contract

- [compatibility/adapted-preload-v1.json](compatibility/adapted-preload-v1.json)
  records the adapted profile, `originalPreload: NOT_EXECUTED`, the generated
  adapter path/hash, page-world document-start injection, the fixed topic and
  call tables, the bounded first-call queue and
  `semantics.ingress: "ABSENT"`.
- [scripts/adapted-preload-check.cjs](scripts/adapted-preload-check.cjs) rejects
  a mismatched profile or schema, a hash mismatch, an original preload, a
  non-page/document-start adapter, a topic/call/queue table that differs from
  the adapter manifest, and unsupported bridge semantics.
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

The generator accepts a host seam from `window.__electronMbtIngress` and deletes
it before page scripts run. The test harness uses that seam for positive queue
flush and event delivery. Production native code currently does not install a
host, so the page path observes the bounded timeout and overflow behavior only.

## Native execution

- `NativeHost.m` accepts `install-adapted-adapter` before the document load.
  The file is canonicalized under the app root, bounded to 65,536 bytes and
  required to be UTF-8.
- `installBootstrapScript` wraps the pinned adapter body with a per-document
  nonce and injects it at document start in `WKContentWorld.pageWorld`, before
  the page's own scripts.
- The wrapper reports `electronMbtAdapterInstalled` with the nonce. Native
  accepts the receipt only from the current main-frame page-world document and
  records whether it arrived before `LoadComplete`. This is an installation
  observation, not a sender grant or ingress authorization.
- `fixtures/native-app/index.html` checks the page-local listener/disposer
  shape and the queue timeout/overflow codes, then sets the title to
  `adapted-api-ok`.
- The supervisor verifies the title, `get-adapted-status`
  (`observed`, `documentStartBeforeLoad`, `ingress: absent`) and the existing
  window load, bootstrap and absent-preload observations.
- A fresh document realm starts with an empty listener table. The existing
  navigation policy still rejects an unrequested same-file reload, so native
  reload event delivery remains untested.

Observed fixture probe (macOS, AppKit + WKWebView):

```json
{"status":"PASS","probe":"native-supervisor-window-load","backend":"AppKit+WKWebView","windowLoaded":true,"adaptedAdapter":true,"pageApi":"adapted-fixture","pageTitle":"adapted-api-ok","bootstrapObserved":true,"preloadStatus":"absent","adapterDocumentStartBeforeLoad":true,"adapterIngress":"absent","compatible":false}
```

Adapter hash:
`99b76fa74f66eb519868dc23189fe4da94144189f5d91efe8c8e8cd4682720bc`.

The contract harness reports 13 cases, 0 failed, including duplicate listener
records, emission snapshots, nested emission, listener throw, queue FIFO with
call-time argument snapshots, count/byte overflow, ready timeout with late-ready
rejection, single settlement, non-JSON argument rejection and fresh-realm
isolation. It is a unit-level check, not native event-delivery evidence.

## Deliberate limits

- no original preload execution and no `contextBridge`/`ipcRenderer`
- no native ingress, main/renderer IPC, invoke/reply or sender/document grant
- no native event delivery; the positive event path uses a test host only
- no `DocumentIngressReady` transition or first-call flush in native; only the
  installation receipt, bounded timeout/overflow and fail-closed page API are
  exercised on a real WKWebView
- no Moji preload adaptation, no Moji app main or app scenario
- this is not `electron-nodeless-v1` strict compatibility and must not be
  admitted as strict evidence

## Next

- connect the native application-message handler and actual sender/document
  admission (EP-14) and replace the test host seam
- define and observe the actual `DocumentIngressReady` transitions separately
  from `LoadComplete` (EP-15)
- deliver fixed native topics to the page-local listener table and test
  reload/host-loss revocation
- generate adapters from Moji's actual preload API and connection graphs
- run Moji with the adapted profile and record app-scenario evidence
