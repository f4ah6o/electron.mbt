# In-process runner integration (EP-09/EP-10 partial)

Status: **partial**. A `Runner` owns one QuickJS engine/context and one timer
scheduler, and `runtime/app_runner` adds source/hash admission, a CJS graph,
Node/Electron prelude dispatch, nextTick/jobs/timers and async handler settle.
The Node-free `native/nodeless` fixture runs this path. It is not a native
supervisor, host event loop, window/renderer or production app runner.

## What is connected

- one QuickJS engine/context per runner
- `run_jobs(max_steps)` over `JS_ExecutePendingJob`
- timer scheduling, next ref deadline and due batches from `runtime/embedded`
- the pre-resolved CJS graph executor from `bridges/embedded-js`
- explicit context/engine teardown

The host still owns wall-clock time, UI events, I/O readiness, shutdown and
process supervision. The runner does not read files, resolve modules, execute
Node builtins or start a native window.

## Verified

`moon test --target native -p runtime/runner` passes:

- a Promise job executes and later evaluation observes its side effect
- a rejecting job is consumed and later evaluation still works; unhandled
  rejection policy is explicitly not claimed
- timers scheduled through the runner return in deadline order
- a due JS callback is retained, invoked once, released, and its Promise jobs run
- a throwing callback is counted as a failure and later evaluation still works
- clearing a timer releases its callback without invoking it
- the CJS graph entry point executes through the same runner

## Open

- nextTick/microtask/timer partial-order fixtures and shutdown deadlines
- timer callback reentrancy, cancellation while running and host-loss interaction
- host event queue, I/O completion and process supervision
- unhandled rejection policy, request-local exception mapping and root ledger
- a native window/host, `BrowserWindow`/`webContents` and renderer
- real `fs`/`fs/promises` broker, zlib stream and updater behavior
- Moji/jmd real app boot and source-preserving asset loading
- fault injection for host loss and runner kill
