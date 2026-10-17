# QuickJS Main dispatch / fixture app scenario

Status: **fixture-only, EP-14 partial (C2a + C2b)**. A page request now reaches
a persistent QuickJS Main fixture and its result returns to the page. There is
no Node, no general app loader and no Moji compatibility.

## Contract

- `moonbit_ebt_supervisor_app_main` keeps the fixture QuickJS runtime/context
  alive after evaluating the fixed CJS graph.
- The fixture main defines `globalThis.__nativeInvoke(operation, payloadJson)`
  and returns a JSON envelope: `{ok:true,result}` or
  `{ok:false,code}`.
- The native host sends `app-request` events with
  `{request, operation, payload}` to the supervisor. The supervisor dispatches
  the operation through the C QuickJS bridge and sends an `app-reply` control
  frame `{request, json}` back.
- The native host stores the page's `WKScriptMessageHandlerWithReply` reply
  block under the request id, resolves it with the Main result or rejects it
  with the Main error code, and removes the pending entry.
- Pending Main replies are failed on begin-load, WebContent termination and
  window teardown. A five-second native timeout also rejects a stuck reply.

## Fixture scenario

The fixture app main handles:

- `app:get-settings` → `{theme:"light", documentTitle:"nodeless-app-ready",
  source:"quickjs-main", app:"native-fixture"}`;
- `app:get-update-state` → `{state:"ready", source:"quickjs-main",
  app:"native-fixture"}`.

The page queues three `getSettings` calls and one `getUpdateState` call. After
the supervisor releases the queue and supplies the Main results, the page
applies the settings to its content and document title. The document title
becomes `nodeless-app-ready`; the native window title remains the separate
`native-app-window`. Three overflow calls still reject with
`ELECTRON_MBT_ADAPTER_QUEUE_FULL`.

The page also registers `onCloseRequest`. After the ingress probe the supervisor
delivers a fixed `app:request-close` event and the page sets
`nodeless-close-requested`. This is an event-delivery scenario, not a Main
close/quit decision, a native close ACK or a physical close. The same event is
delivered after the generation-2 reload.

## Evidence

The supervisor reports:

```json
{"nativeQueueRelease":true,"nativeQueueAdmitted":4,"nativeMainRoundTrip":true,"appScenario":"nodeless-fixture","pageTitle":"nodeless-app-ready","closeRequest":true,"closeRequestReload":true}
```

The page verifies that the first three results are Main settings with
`source:"quickjs-main"` and `theme:"light"`, the fourth is Main state with
`state:"ready"`, and the overflow calls remain queue failures. The same
scenario runs after the generation-2 reload.

## Deliberate limits

- the Main fixture is a fixed CJS graph in `native/supervisor/supervisor.c`;
  this is not a general app loader, module graph or Node symbol layer
- the source snapshot covers the page entry and adapter, not the Main graph;
  Main source changes are outside the snapshot (B2b remains open)
- the close scenario is a page-side event observation only; there is no native
  close/quit decision, close ACK or physical UI acceptance
- no `contextBridge`, `ipcRenderer` or `webContents.send`
- no Moji main/preload boot, no app compatibility and no verified row
- `compatible:false`, adapted **partial** and strict **blocked** are unchanged

## Next

- move the Main graph and its dependencies into the source snapshot, then add
  the general CJS loader and Node symbols
- replace the event-only close observation with a Main/native close decision
- replace the test-only queue release with the production
  `DocumentIngressReady` transition
- adapt Moji's main/preload and run an app scenario
