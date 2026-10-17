# Moji preload virtual boot

Status: **PASS for a virtual CJS evaluation only**. The pinned preload is
evaluated in the QuickJS harness with a virtual `contextBridge`/`ipcRenderer`/
`webUtils` facade; it exposes `api` with 18 methods. The preload is still
**NOT_EXECUTED in WebKit** and no contextBridge safety is claimed.

## What happens

- The harness adds virtual `electron.contextBridge.exposeInMainWorld`,
  `ipcRenderer` and `webUtils`.
- `__mojiBootFinish` loads `out/preload/preload.js` through the same CJS loader
  and captures the exposed `api` object.
- The exposed methods exactly match the generated adapted API surface:
  `getSettings`, `setSettings`, `openDialog`, `readPath`,
  `readImageAsDataUrl`, `openLocalPath`, `readSample`, `save`, `saveAs`,
  `exportAs`, `exportDiagramPng`, `confirmClose`, `getUpdateState`,
  `checkForUpdate`, `getDroppedPath`, `onOpenDocument`, `onCloseRequest`,
  `onUpdateState` (18).
- The preload's IPC methods are not invoked; `ipcRenderer` is a stub.

## Evidence

`node scripts/m1-moji-boot.cjs` → PASS:

```json
{"preloadPresent":true,"preloadExecuted":false,"preloadVirtualExecuted":true,
 "preloadMethods":18,"preloadExposed":["api"]}
```

Readiness `moji-main-boot` requires `preloadVirtualExecuted` and
`preloadMethods:18`. The report is
[compatibility/reports/moji-boot.json](compatibility/reports/moji-boot.json).

## Deliberate limits

- virtual evaluation is **not** WebKit execution; `preloadExecuted` remains
  `false` and the M0 contextBridge gate is still unresolved
- `ipcRenderer`, `contextBridge` and `webUtils` are stubs; no channel, listener
  or file path behavior is proven
- the adapted API remains the page-world substitute used by the renderer
- no preload IPC call, listener or file drag is exercised
- `moji-preload-runtime` remains FAIL
- `compatible:false`, adapted **partial**, strict **blocked** unchanged

## Next

- resolve the WebKit contextBridge gate and execute the preload in the renderer
- or explicitly keep the adapted adapter as the supported preload substitute
