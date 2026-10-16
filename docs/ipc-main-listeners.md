# Main-local IPC listener increment

Status: implementation added; acceptance depends on the exact-HEAD CI evidence. This is a bounded main-process listener profile, not working renderer IPC or an Electron compatibility claim. It is stacked on PR #8 so reference admission remains completed, version-pinned and same-fixture. PR #2, PR #3 and main are not changed by this increment.

## 1. Implemented boundary

`require('electron').ipcMain` now implements `on` / `addListener`, `once`, `off` / `removeListener`, `removeAllListeners`, `listeners`, `rawListeners`, `listenerCount`, and main-local `emit` for ordinary string channels. Registration is allowed before app readiness. Removal selects the most recent matching registration. Emission snapshots preserve in-flight callback ordering; once wrappers remain one-shot under nested emission, removal and exceptions.

MoonBit owns the bounded registration ledger, registration order, monotonic identifiers, channel policy and stop cleanup. JavaScript retains actual function/wrapper identity and invokes those functions synchronously in their main realm; functions never cross the JSON boundary. Main callbacks survive document navigation because registering an app listener is not granting renderer authority. A regression requires an ungranted renderer request to remain denied after registration.

Limits: 256 total registrations per runtime, 128 UTF-16 units per channel, 16,384 string units per JSON envelope, monotonic signed-32-bit listener IDs with fail-closed exhaustion. Empty channels and malformed JavaScript strings are rejected. `error`, `newListener` and `removeListener` channels are explicitly denied because their special EventEmitter behavior is outside this increment. Symbols, borrowed/mutated EventEmitter methods, custom wrapper mutation and the rest of the EventEmitter surface are not a claimed compatibility profile. `handle`, `handleOnce`, `removeHandler`, prepend methods, emitter configuration and eventNames remain typed unsupported methods.

## 2. What this does not enable

There is no renderer ingress, native sender/frame/document attestation, `ipcRenderer.send`/`invoke`, `event.reply`, generated sender object, preload adaptation or synchronous `contextBridge`. Main-local `ipcMain.emit` accepts objects from trusted main code only; its test events are not authenticated renderer events. Normal `run` and `pack` stay fail-closed, every compatibility gate remains open, and `compatible:false` is unchanged. The Node-less QuickJS/TS/real-app plan in PR #3 is still separate and unimplemented here.

## 3. Evidence and failure reporting

`fixtures/ipc-listeners` is run unchanged by the pinned real Electron and the electron.mbt facade. Its 12 assertions cover fluent/alias methods, registration order, receiver and argument identity, most-recent duplicate removal, removal/addition during emission, nested once, remove-all during emission, exceptions, original/wrapper removal, and isolated snapshots. The MoonBit baseline-admission policy checks the real reference before starting the candidate; both process exits and source hashes must pass. The core comparator must report equivalent. The artifact is `evidence/ipc-main-listeners.json`, explicitly scoped to main-local listeners.

The existing full `fixtures/oracle` is not modified. Listener registration lets it reach readiness, where the current facade still lacks BrowserWindow. Its own catch path reports `failed` / `ready-rejected` and exits 1. The differential runner preserves that failed status, partial trace and `exitCode:1`; it does not promote it to completed. A completed marker followed by nonzero exit, timeout, signal, malformed marker or unclassified failure remains a harness error. Reference-side admission still rejects every failed or aborted Electron baseline. The full comparison remains divergent, not compatible.

## 4. Commands and acceptance

1. `moon check --target js`; `moon test --target js`; `moon test --target native`.
2. `npm run build`; `npm test` on Linux and macOS. New contracts are `core/ipc_listeners_wbtest.mbt`, `tests/ipc-listeners.test.cjs`, and `tests/candidate-observation.test.cjs`.
3. On Apple Silicon macOS: `node scripts/ipc-listener-oracle.cjs <absolute-pinned-electron>` and `node scripts/differential.cjs --baseline evidence/electron-baseline.json`.

A passing unit suite is not an independent review or sender-authentication test. Native renderer delivery, strict bridge security, real-app scenarios, Node-free distribution and packaging remain NOT RUN for this increment. Keep Draft; do not merge or update main without explicit authorization.
