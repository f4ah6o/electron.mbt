# Moji adapted API (generated)

Status: **API shape generated, fixture handlers partial, runtime
NOT_IMPLEMENTED**. This is the first slice that derives an adapted adapter from
Moji's real preload contract and registers a few fixture-only Main handlers.
The original preload and Moji main are not executed.

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

## Fixture Main handlers

The fixture QuickJS Main now uses an operation registry:

- registered: `settings:get`, `settings:set`, `update:get-state`,
  `update:check`, `app:confirm-close` (fixture in-memory settings and idle
  updater state);
- `file:read-path`, `file:save`, `file:read-image` and `file:read-sample` are
  handled by the native file broker with grants/bounds, not Main
  ([docs/0027-file-broker.md](0027-file-broker.md));
- `file:open-dialog` and `file:save-as` have a test-injected grant path and
  compiled AppKit panels; the UI is NOT RUN
  ([docs/0028-dialogs.md](0028-dialogs.md));
- `doc:export` writes HTML and `diagram:export-png` writes a validated PNG
  through test-injected save paths; PDF/PNG document rendering remains
  unsupported ([docs/0029-export.md](0029-export.md));
- the native `settings:get` / `settings:set` / `settings:get` /
  `update:get-state` / `app:confirm-close` sequence resolves with Main values,
  while `file:read-path` remains typed unknown.

## Evidence

- `node scripts/moji-adapted-check.cjs` → PASS: preload hash, adapter hash,
  manifest/record shape, 14 calls, 3 topics, `getDroppedPath` unsupported,
  runtime `NOT_IMPLEMENTED`.
- `scripts/moji-adapted-api-check.cjs` → 5 cases PASS: shape/arity, disposers
  and duplicate records, argument snapshot/FIFO, queue bound, ingress deadline.
- The native fixture routes a Moji-shaped `settings:get` request through the
  `electronMbtApp` prefix allowlist into QuickJS Main; the unregistered
  operation fails closed with `ELECTRON_MBT_MAIN_UNKNOWN_OPERATION`, observed as
  `mojiOperationRouted: true` and `mojiHandlers: true` in the supervisor probe.

## Deliberate limits

- the original Moji preload is **NOT_EXECUTED**; this is not contextBridge or
  ipcRenderer compatibility
- the registered handlers are fixture-only; settings are in-memory and the
  updater returns an idle fixture state, not Moji's updater
- the file broker is partial: grants are test-only, dialog/save-panel UI is
  NOT RUN, and document PDF/PNG rendering is unsupported
- `getDroppedPath` (`webUtils.getPathForFile`) is unsupported by design
- no file read/save broker, dialog, export, updater or OS service is connected
- no Moji main boot, renderer boot, app scenario or verified row
- `compatible:false`, adapted **partial** and strict **blocked** are unchanged

## Next

- add open/save dialogs and export, then replace the fixture settings/updater
  with Moji's real main handlers
- boot Moji's real main/preload graph with the adapted API and record an app
  scenario
- add Node builtins required by Moji main (`node:url`, `node:zlib`; `node:fs`
  through the file broker)
