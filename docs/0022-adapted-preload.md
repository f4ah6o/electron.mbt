# Adapted preload / generated page API (fixture)

Status: **fixture-only, G2 partial**. This is the first implemented slice of
`electron-nodeless-adapted-v1` preload adaptation. It does **not** run the Moji
preload, implement `contextBridge`/`ipcRenderer`, connect renderer ingress or
claim app compatibility.

## Contract

- [compatibility/adapted-preload-v1.json](compatibility/adapted-preload-v1.json)
  records the adapted profile, `originalPreload: NOT_EXECUTED`, the generated
  adapter path/hash, page-world document-start injection and the exposed API.
- [scripts/adapted-preload-check.cjs](scripts/adapted-preload-check.cjs)
  rejects a mismatched profile, a hash mismatch, an original preload or a
  non-page/document-start adapter.
- [scripts/adapted-adapter.cjs](scripts/adapted-adapter.cjs) deterministically
  generates the adapter from `fixtures/native-app/adapted/api.json`.

The fixture API is a frozen `window.api.version()` returning `adapted-fixture`.
It is a generated page-world constant, not a cross-world function proxy and not
a main-process IPC result.

## Native execution

- `NativeHost.m` accepts `install-adapted-adapter` before the document load.
  The file is canonicalized under the app root, bounded to 65,536 bytes and
  required to be UTF-8.
- `installBootstrapScript` injects the generated source at document start in
  `WKContentWorld.pageWorld`, before the page's own scripts.
- `fixtures/native-app/index.html` checks `window.api.version()` and sets the
  title to `adapted-api-ok`.
- The supervisor verifies `get-web-contents-title == adapted-api-ok` alongside
  the existing window load, bootstrap status and absent preload status.

Observed fixture probe:

```json
{"status":"PASS","probe":"native-supervisor-window-load","windowLoaded":true,"adaptedAdapter":true,"pageApi":"adapted-fixture","pageTitle":"adapted-api-ok","bootstrapObserved":true,"preloadStatus":"absent","compatible":false}
```

## Deliberate limits

- no original preload execution and no `contextBridge`/`ipcRenderer`
- no main/renderer IPC, invoke/reply, first-page queue, sender/origin/generation
  grant or renderer ingress
- no Moji preload adaptation, no Moji app main or app scenario
- generated methods are constants only; no user data or host service
- this is not `electron-nodeless-v1` strict compatibility and must not be
  admitted as strict evidence

## Next

- generate adapters from Moji's actual preload API and connection graphs
- connect page API calls to main handlers with native sender/document authority
- implement bounded first-page queue and listener disposers
- run Moji with adapted profile and record app-scenario evidence
