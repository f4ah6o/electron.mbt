# Async Main handler dispatch

Status: **partial, PASS for microtask-resolving handlers**. The page bridge can
now await a Moji `ipcMain` handler that returns a Promise, as long as the
promise resolves through QuickJS microtasks. `checkForUpdate` exercises this
path.

## Mechanism

- The harness `__nativeInvoke` attaches `then`/`catch` to an async handler
  result, records a JSON result in `state.pendingResult`, and returns
  `ELECTRON_MBT_MAIN_ASYNC_PENDING`.
- The C `supervisor_app_dispatch` sees that marker, drains
  `JS_ExecutePendingJob`, then calls `__mojiPendingResult()` and returns the
  settled JSON.
- If the promise does not settle in the drained jobs, the bridge returns
  `ELECTRON_MBT_MAIN_ASYNC_ERROR`; the native app-reply timeout still applies.
- Sync handlers are unchanged.

## Evidence

The real renderer API probe calls `window.api.checkForUpdate()` and receives
`{status:"unsupported"}` from the QuickJS Moji handler:

```json
{"checkForUpdate":"unsupported","updateCheckOk":true}
```

`moji-renderer` readiness now requires `updateCheckOk` along with
open/save/export/sample/settings.

## Deliberate limits

- only microtask-resolving promises are supported; timers, native I/O, real
  updater network work and dialog completion promises are not driven by this
  path
- file/dialog/export operations use the native broker, not async Main handlers
- no cancellation, concurrency limit or per-handler timeout beyond the native
  five-second reply timeout
- `checkForUpdate` returns the fixture/unsupported update state, not a real
  updater result
- original preload remains **NOT_EXECUTED**
- `compatible:false`, adapted **partial**, strict **blocked** unchanged

## Next

- extend async dispatch to timers/native completion promises with bounded
  cancellation and per-handler deadlines
- connect real update/file handlers where the native broker is not the right
  layer
- keep the original preload unexecuted until the contextBridge gate is resolved
