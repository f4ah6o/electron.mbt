# Moji adapted API (generated)

Status: **API shape generated, runtime NOT_IMPLEMENTED**. This is the first
slice that derives an adapted adapter from Moji's real preload contract. The
original preload is not executed and no Moji main handler is connected.

## Source of truth

- Pinned Moji preload: `out/preload/preload.js` (external built app source,
  `/tmp/electron-mbt-apps/moji`), SHA-256
  `bd0f47d61f79ffa68ebd1a65186d0afc477448ac8c3c911ac8d52aab5d38c544`, matching
  `compatibility/apps/moji-v1.0.5/build-provenance.json`.
- [fixtures/moji-adapted/api.json](fixtures/moji-adapted/api.json) records the
  generated API manifest (schema 3).
- [fixtures/moji-adapted/page-api.js](fixtures/moji-adapted/page-api.js) is the
  generated page-world adapter, SHA-256
  `28fe7607d62dc7695e7d7dccb9740c85ef4f0709e50219ae3567423c4fa13a9c`.
- [compatibility/apps/moji-v1.0.5/adapted-preload.json](compatibility/apps/moji-v1.0.5/adapted-preload.json)
  records `originalPreload: NOT_EXECUTED`, the preload/adapter hashes, queue
  bounds and `runtime: NOT_IMPLEMENTED`.

## Generated API

Fourteen IPC-shaped calls plus one explicit unsupported method and three
events:

| Method | Operation | Arguments |
| --- | --- | --- |
| `getSettings` | `settings:get` | none |
| `setSettings` | `settings:set` | one JSON value |
| `openDialog` | `file:open-dialog` | none |
| `readPath` | `file:read-path` | one |
| `readImageAsDataUrl` | `file:read-image` | one |
| `openLocalPath` | `file:open-local-path` | one |
| `readSample` | `file:read-sample` | one |
| `save` | `file:save` | two |
| `saveAs` | `file:save-as` | two |
| `exportAs` | `doc:export` | one |
| `exportDiagramPng` | `diagram:export-png` | one |
| `confirmClose` | `app:confirm-close` | one |
| `getUpdateState` | `update:get-state` | none |
| `checkForUpdate` | `update:check` | none |
| `getDroppedPath` | — | typed `ELECTRON_MBT_UNSUPPORTED_API` |
| `onOpenDocument` | `doc:open` | callback + sync disposer |
| `onCloseRequest` | `app:request-close` | callback + sync disposer |
| `onUpdateState` | `update:state` | callback + sync disposer |

The schema-3 generator emits the declared arity, snapshots the actual argument
array at call time and applies the queue count/byte bounds. The adapter never
exposes `contextBridge`, `ipcRenderer` or a generic `send(channel, ...)`.

## Evidence

- `node scripts/moji-adapted-check.cjs` → PASS: preload hash, adapter hash,
  manifest/record shape, 14 calls, 3 topics, `getDroppedPath` unsupported,
  runtime `NOT_IMPLEMENTED`.
- `scripts/moji-adapted-api-check.cjs` → 5 cases PASS: shape/arity, disposers
  and duplicate records, argument snapshot/FIFO, queue bound, ingress deadline.
- The native fixture routes a Moji-shaped `settings:get` request through the
  `electronMbtApp` prefix allowlist into QuickJS Main; the unregistered
  operation fails closed with `ELECTRON_MBT_MAIN_UNKNOWN_OPERATION`, observed as
  `mojiOperationRouted: true` in the supervisor probe.

## Deliberate limits

- the original Moji preload is **NOT_EXECUTED**; this is not contextBridge or
  ipcRenderer compatibility
- no Moji main handler is registered; `settings:get` is an unknown operation in
  the fixture Main
- `getDroppedPath` (`webUtils.getPathForFile`) is unsupported by design
- no file read/save broker, dialog, export, updater or OS service is connected
- no Moji main boot, renderer boot, app scenario or verified row
- `compatible:false`, adapted **partial** and strict **blocked** are unchanged

## Next

- register the 14 Moji operations in the Main handler registry and implement
  file/dialog/export handlers through EP-16/EP-18
- boot Moji's real main/preload graph with the adapted API and record an app
  scenario
- add Node builtins required by Moji main (`node:url`, `node:zlib`; `node:fs`
  through the file broker)
