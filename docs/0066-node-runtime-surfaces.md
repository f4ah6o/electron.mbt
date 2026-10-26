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
| `electron.protocol` | `registerSchemesAsPrivileged` no-op; `handle` stores the handler; `isProtocolHandled`, `unhandle` | stored handlers are **not executed**; `moji-asset://` requests are not served; the other `register*` APIs fail closed |
| global `performance` | alias of the `perf_hooks` object | same limits |
| `node:zlib` | importable (`createDeflate` remains the existing unsupported stub) | PNG/export compression is not implemented |

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

This means the main process and native window boot. It is **not** a working app:
the plain stage has no adapted `window.api`, the renderer probe is not loaded,
and `moji-asset` handlers are not executed. The adapted 1.0.5 stage still reaches
`HOLDING`/`HOLD_EXIT` and exits 0.

Next for 1.0.7 is an adapted API manifest (including drafts/openMany and the
`readPath` stream contract), then renderer verification; zlib and real worker
threads remain separate gaps.

## Tests

- `moon test --target native`: 198 PASS (new runtime-surfaces test).
- `moon test --target js`: 163 PASS.
- `npm test`: 533 tests / 500 PASS / 0 FAIL / 33 SKIP.
- `compatible:true` is not produced.
