# Capturing an adapted API from a built preload

Status: generic developer tool, Linux-verified; `compatible:false`. This is not
preload execution in the app runtime.

The adapted profile deliberately does **not** execute the original preload.
A captured preload surface lets an app get its `contextBridge` API back without
running the preload or shipping Electron.

## Tool

```sh
node scripts/capture-preload-api.cjs <preload.js> \
  --name api --out <manifest.json> \
  [--operation method=operation ...]
```

The tool evaluates the built preload once in a Node `vm` with a fake
`electron.contextBridge` / `ipcRenderer` / `webUtils`. For every exposed function
it records the first IPC call (`invoke`, `send`, `sendSync` or `postMessage`) or
event registration (`on`/`once`) and writes a schema-3 adapted manifest. It does
not install the preload in the app and does not run a second loader.

- `--operation readPath=emoon:read-file` overrides a recorded operation. Use this
  when a preload uses a streaming/port call but the app can consume a simple
  granted-file result.
- Methods with no observed IPC (for example `webUtils.getPathForFile`-based
  drag-and-drop) are emitted under `unsupported`.
- The generated manifest is the same schema consumed by
  `emoon init --api <manifest>`; it is data, not app-specific runtime code.

### Limitations

- Only the first IPC call per method is recorded; conditional or multiple calls
  need review.
- `send`/`postMessage` methods are represented as adapted calls. The runtime's
  adapted dispatch is request/reply; a send-style method may reject if the main
  did not register a matching handler.
- Local `require` from the preload is not executed; only `electron` and Node
  builtins are available in the capture sandbox.
- Executing a preload is a developer action. Review the preload and generated
  manifest before staging.

## `emoon:read-file`

The adapted runtime has one generic granted-file operation,
`emoon:read-file` (one string argument):

- Reads through the host `main-read-file` path, so app-local files and
  session-granted open-dialog files are accepted; other paths fail closed.
- Returns `{ok:true,path,content,sizeBytes,sizeProfile:"normal"}`. The host read
  is capped at 256 KiB; larger documents need a future streaming implementation.
- Fails with the host code (for example `EACCES`, `ENOENT`) when the grant or
  file is missing.

## Moji 1.0.7 walkthrough

```sh
node scripts/capture-preload-api.cjs _build/Moji/out/preload/preload.js \
  --name api --out _build/Moji/adapted-preload.json \
  --operation readPath=emoon:read-file

dist/emoon init _build/Moji --api adapted-preload.json --force
dist/emoon dev _build/Moji --force --no-launch
dist/emoon run _build/Moji/.emoon/app --window --hold --entry out/main/main.js
```

Observed with the built 1.0.7 source on Linux:

- manifest: 23 calls, 6 topics, 1 unsupported (`getDroppedPath`);
- stage: 143 files, doctor `ready`, profile `electron-nodeless-adapted-v1`;
- window: `rendererLoaded:true`, `apiPresent:true`, page text starts with
  `New / Open / Save / Preview / Editor / Export` and
  `A LIGHTWEIGHT, SIMPLE MARKDOWN READER`;
- adapted: 4 requests, 0 reply errors, 0 rejected, released;
- hold: `HOLDING` then `HOLD_EXIT reason:"window-closed"`, exit 0.

This proves the initial renderer and the captured API. File opening, editing,
saving, drag-and-drop, export, dialogs and `moji-asset://` images are **NOT
verified**; `worker_threads`, zlib compression and protocol handlers remain
limited. No `compatible:true` is produced.
