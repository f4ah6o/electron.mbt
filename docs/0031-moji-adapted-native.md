# Moji adapted native E2E (page → ingress → handlers)

Status: **PASS for a focused native E2E**. A page-world Moji adapted adapter
calls `getSettings`/`getUpdateState`; the calls cross the native ingress, reach
the QuickJS Moji main and invoke its real `settings:get`/`update:get-state`
handlers. The original preload is **NOT_EXECUTED** and the real Moji renderer is
not loaded.

## Shape

- Temp app root: pinned `out/main/main.js`, `out/preload/preload.js`,
  `fixtures/moji-boot/harness.js`, generated
  `fixtures/moji-adapted/page-api.js`, a small probe `index.html` and
  `package.json`.
- Supervisor Moji app mode: create window, `prepare-source`, boot the Moji
  main/harness, install `__nativeInvoke` as a bridge to registered
  `ipcHandlers`, install the adapter, load the probe page, release the adapter
  ingress and pump `app-request` events.
- The probe page calls `window.api.getSettings()` and
  `window.api.getUpdateState()`, then sets
  `moji-adapted-ready:dark:unsupported`.
- The native `settings:get` / `update:get-state` operations are dispatched to
  the QuickJS Moji handlers. Unregistered operations fail closed; async handlers
  currently return `ELECTRON_MBT_MAIN_ASYNC_PENDING`.

## Evidence

`node scripts/m1-moji-adapted-native.cjs` → PASS:

```json
{"status":"PASS","probe":"moji-adapted-native","backend":"AppKit+WKWebView","pageLoaded":true,"apiPresent":true,"settingsTheme":"dark","updateStatus":"unsupported","mainHandlers":true,"compatible":false}
```

The report records `mainSHA256` (`41cd...`), `preloadSHA256` (`bd0f...`),
`adapterSHA256` (`bdfe...`), `harnessSHA256` (`6c89...`), `preloadExecuted:false`
and `rendererLoaded:false`. It is stored at
[compatibility/reports/moji-adapted-native.json](compatibility/reports/moji-adapted-native.json);
readiness row `moji-adapted-native` is PASS.

## Deliberate limits

- the page is a small probe, **not** Moji's real renderer and 13 MB asset graph
- the original preload is **NOT_EXECUTED**; contextBridge/ipcRenderer remains
  the unresolved gate
- only synchronous `settings:get` and `update:get-state` cross the bridge;
  file/dialog/export handlers are async and return `ASYNC_PENDING`
- the adapter ingress release is the test-only native operation; production
  readiness remains unresolved
- the native window is hidden and there is no renderer UI assertion beyond the
  probe title
- no app scenario, no verified row, `compatible:false`, adapted **partial** and
  strict **blocked** unchanged

## Next

- load the real Moji renderer and its asset graph under the adapted adapter
- add async handler dispatch for file/dialog/export
- exercise real dialog UI and PDF/PNG document export
- keep the original preload unexecuted until the contextBridge gate is resolved
