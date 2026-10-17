# Moji main boot (smoke)

Status: **PASS for a virtual QuickJS boot smoke**. Moji's real bundled main
evaluates, reaches `app.whenReady()`, creates one virtual window and registers
14 IPC handlers. The original preload is present in the boot graph but
**NOT_EXECUTED**; no native window or renderer is created.

## Boot graph

| File | SHA-256 |
| --- | --- |
| `out/main/main.js` | `41cd703c31002c0a80f3e6407f2743a93f60a686eb3084cd08cb98cf31f7046e` |
| `out/preload/preload.js` | `bd0f47d61f79ffa68ebd1a65186d0afc477448ac8c3c911ac8d52aab5d38c544` |
| `harness.js` | generated fixture harness in this repository |
| `package.json` | minimal `{name:"moji", version:"1.0.5", main:"out/main/main.js"}` |

The hashes match `compatibility/apps/moji-v1.0.5/build-provenance.json`.

## Harness

[fixtures/moji-boot/harness.js](fixtures/moji-boot/harness.js) provides a
bounded CommonJS loader and a **virtual** Electron/Node facade:

- `electron.app`, `BrowserWindow`, `ipcMain`, `dialog`, `Menu`, `screen`,
  `shell`;
- `node:fs` (exists/read/write virtual), `node:fs/promises`, `node:path`,
  `node:url`, `node:zlib`;
- `process`, `Buffer`, `__dirname`, `__filename`;
- `electron-updater` stub (updates are unsupported while `isPackaged` is false).

The C supervisor evaluates the harness in QuickJS, calls `__mojiBoot()`, drains
pending jobs (the `whenReady().then(...)` callback), then calls
`__mojiBootFinish()` and reads `__nativeBootReport`.

## Evidence

`node scripts/m1-moji-boot.cjs` → PASS:

```json
{"status":"PASS","probe":"moji-main-boot","app":"moji-v1.0.5","entry":"out/main/main.js","mainEvaluated":true,"whenReady":true,"windows":1,"ipcHandlers":14,"preloadPresent":true,"preloadExecuted":false,"compatible":false}
```

The report is stored at
[compatibility/reports/moji-boot.json](compatibility/reports/moji-boot.json)
and the readiness row `moji-main-boot` is PASS.

## Deliberate limits

- this is a **virtual** boot: no native `BrowserWindow`, WKWebView, renderer,
  menu, dialog or real IPC handler invocation
- the original preload is parsed only as a source asset; it is **NOT_EXECUTED**
  and contextBridge/ipcRenderer remains the unresolved gate
- `electron-updater`, `fs`, `zlib` and dialogs are virtual stubs; no update,
  file, save or export flow is connected
- the 14 IPC handlers are registered but not called; no renderer call reaches
  Moji's main
- the adapted API remains the page-world substitute, not contextBridge
- no app scenario, no verified row, `compatible:false`, adapted **partial** and
  strict **blocked** unchanged

## Next

- connect the adapted API calls to the registered Moji IPC handlers
- create a real native window/renderer and load the Moji renderer under the
  adapted profile
- implement document PDF/PNG export and exercise real dialogs
- keep the original preload unexecuted until the contextBridge gate is resolved
