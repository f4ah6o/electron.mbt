# Node runtime surfaces for the Moji 1.0.7 main

Status: minimal **boot/import surfaces**, Linux-verified; `compatible:false`. These
are not general Node implementations and do not make the Moji 1.0.7 renderer
work.

## Added surfaces

| module | surface | limits |
| --- | --- | --- |
| `node:v8` | `getHeapStatistics()` returns a fixed 256 MiB `heap_size_limit`; `getHeapSpaceStatistics()`, `setFlagsFromString` | no real heap statistics; `serialize`/`deserialize` fail closed |
| `node:worker_threads` | importable; `isMainThread:true`, `parentPort:null`, `workerData:null` | `Worker`, `MessageChannel`, `MessagePort` throw `ELECTRON_MBT_UNSUPPORTED_API`; no worker execution |
| `node:perf_hooks` | in-process `performance.mark/measure/getEntriesByName/getEntriesByType/clearMarks/clearMeasures/now` | local 1,024-measure buffer; no inspector/observer integration |
| `node:os` | `platform`, `arch`, `release`, `version`, `type`, `cpus`, `totalmem`, `freemem`, `tmpdir`, `homedir`, `hostname`, `uptime`, `loadavg`, `endianness`, `networkInterfaces`, `userInfo` | `cpus`/memory/release are placeholders where the host does not provide them |
| `electron.protocol` | `registerSchemesAsPrivileged` validates the staged `assetSchemes` and the safe privilege subset; `handle` records the handler; the native host serves admitted schemes from app-root/session asset directories; `isProtocolHandled`, `unhandle` | stored handlers are **not executed**; `bypassCSP`/service workers/code cache/stream are rejected; responses carry status/CORS/nosniff headers; other `register*` APIs fail closed; [docs/0074](0074-custom-protocol-asset-broker.md) |
| global `performance` | alias of the `perf_hooks` object | same limits |
| `node:zlib` | importable; `createDeflate` uses host zlib with stored fallback | PNG/export compression works on Linux; hostless unit contexts use stored blocks |

## jmd 0.2.3 added surfaces

| surface | behavior | limits |
| --- | --- | --- |
| `fs.watch` | bounded 250 ms `fs.stat` poller; `FSWatcher` with `on('change')`, `close()`, `persistent`; emits on mtime/size change | polling, not inotify; no `fs.watchFile`, recursive watch or native event fidelity |
| `BrowserWindow.loadFile(file, { query })` | string/number/boolean values percent-encoded in key insertion order; entry URL accepts a query; empty/absent query unchanged | only the entry document query is verified; `loadURL` query and unusual types are not covered |
| `dialog.showMessageBox`/`Sync` | deterministic response 0..2 only when `ELECTRON_MBT_TEST_MESSAGE_BOX` is set; otherwise typed unsupported | no native GTK message box, no human input, no destructive default |
| `screen.getDisplayNearestPoint`/`getPrimaryDisplay` | GDK monitor `bounds`, `workArea`, `size`, `scaleFactor`; `getAllDisplays`, nearest-point containment/center and matching-rect intersection | hardware multi-monitor NOT RUN; two-display test injection; 1280x800 fallback if the host op is unavailable |
| `electron.net` | `fetch` supports bounded http(s) GET/HEAD via the host (512 KiB response, 5 s, no redirects/credentials); `request` is a buffered ClientRequest-like EventEmitter (GET/HEAD/POST/PUT/PATCH/DELETE, 256 KiB request body, 512 KiB response); `isOnline` returns `false` | no proxy/stream/backpressure/abort-cancellation; bodies are buffered |
| `Menu` | `buildFromTemplate`/`setApplicationMenu` install a bounded native GtkMenuBar; click handlers dispatch by stable id; `CmdOrCtrl` accelerators map to WebView key handling; allowlisted roles (editing, zoom, fullscreen, minimize/close) execute natively | `toggleDevTools`/unknown roles are no-op; no arbitrary host command |

## Moji 1.0.7 evidence

A plain stage from the built 1.0.7 source now reaches:

```json
{"probe":"nodeless-window-runtime","status":"PASS",
 "app":{"name":"moji","version":"1.0.7"},
 "windowLoaded":true,"pageTitle":"Moji v1.0.7",
 "rendererLoaded":false,"renderer":{"loaded":false,"rootChildren":0,"apiPresent":false},
 "adapted":{"configured":false,"requests":0},
 "mainError":"","compatible":false}
```

This means the main process and native window boot. With a captured adapted
manifest, the same 1.0.7 stage reaches `rendererLoaded:true`, `apiPresent:true`,
4 requests / 0 reply errors and the initial Moji UI; see
[docs/0067](0067-preload-api-capture.md). File opening, editing, export,
`moji-asset://` images, zlib and real workers remain unverified or limited.

## Tests

- `moon test --target native`: 198 PASS (new runtime-surfaces test).
- `moon test --target js`: 163 PASS.
- `npm test`: 533 tests / 500 PASS / 0 FAIL / 33 SKIP.
- `compatible:true` is not produced.
