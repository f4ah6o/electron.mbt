# Invoke handler kernel (increment after PR #9)

Status: implemented; the new invoke JSON/undefined profile requires exact-commit Electron oracle validation. Draft only. No main update, no merge, no compatibility gate promoted.

## 1. New behavior

The main facade now supports `ipcMain.handle`, `handleOnce`, and `removeHandler` for non-empty well-formed string channels up to 128 UTF-16 units. Registration and removal return undefined. A duplicate is rejected without replacing the original; handler and EventEmitter listener registries remain independent. Removal affects future calls, not a captured in-flight handler. This supersedes the unsupported handler statements in the earlier listener-increment document.

A MoonBit `InvokeRegistry` is bound to the existing Runtime. It owns 128 handler registrations, non-reused handler IDs, and at most 256 invocation tickets. The existing request ledger still enforces the shared 256 pending/cancellation slots, 1 MiB payload and 4 MiB queued-byte budgets. A second 256-ticket bound prevents draining external cancellation notifications from bypassing the invocation-owner budget. Core stop revokes authority; the facade's existing stop/dispose path also releases callback references and tickets.

`handleOnce` is consumed only after authorization, handler lookup and request allocation succeed, before the callback runs. Foreign origin, subframe, stale generation, invalid payload or exhausted capacity cannot consume it. Callback identity and JS Promise/thenable execution remain in the main JS realm; the registry does not serialize functions.

## 2. Private driver, not a renderer API

The internal `createIpcMain` controller additionally exposes `invoke(hostSender, channel, args, event)` and `reconcile()`. Neither is a property of the public `ipcMain` facade. `hostSender` is a trusted-host contract with window, document generation, origin and main-frame status. It is NOT authentication of renderer-supplied JSON. There is no production native ingress in this increment; a later native adapter must derive this metadata from the real WebView/frame and construct the event itself.

The adapter now copies arguments and results through a bounded, tagged `invoke-json-undefined-v1` leaf codec. Unlike raw `JSON.stringify`, the explicit variant envelope preserves `undefined` at the top level and in dense arrays/plain enumerable records (including literal `__proto__` keys), without confusing a user record with an internal marker. Functions, proxies, accessors, cycles, repeated object identity, sparse arrays and non-finite values remain unsupported. The MoonBit request ledger owns the request lifetime, channel authorization and maximum encoded payload length. Unsupported results reject instead of being erased; this is not full Structured Clone. Error replies carry a bounded message (up to 1024 string units), not original error properties, stacks, accessors or proxies. This is not the complete Electron structured-clone or error-message-format contract. Invalid callback arguments to handleOnce are rejected immediately, deliberately stricter than the pinned Electron implementation's incidental delayed failure; only documented callable handlers are in this profile.

A completion checks the core-owned captured ticket before traversing any result payload, then revalidates while finalizing. This prevents stale results from being encoded or allowed to override a cancellation error. Navigation, destroy or stop prevents delivery of a late result. Native lifecycle integration must call `reconcile()` after invalidation to reject never-settling JS promises promptly. It acknowledges only its own cancellation IDs, leaving other services' notifications intact. Disposal rejects all remaining calls. Arbitrary async handlers have no implicit timeout: the request budget supplies backpressure, while native transport watchdogs are a separate future host concern. Cancellation does not undo main-side effects.

## 3. Differential evidence scope

`fixtures/ipc-handlers/scenario.cjs` contains 16 shared behavior scenarios: return values, duplicate/invalid registration, arguments/receiver, sync/Promise/thenable results, thrown/rejected errors, once consumption/re-registration, in-flight replacement, listener independence, value copying, removal, top-level undefined and undefined slots in argument/result arrays and records.

The reference driver uses actual pinned Electron 44.7.0 renderer IPC with a sandboxed isolated preload. The candidate driver uses the production invocation kernel with explicit synthetic host metadata, without a renderer. All fixture files are hashed before/after both runs. Only status, scenario trace and scenario measurements are projected into the core comparator; module identity, real sender identity and driver equivalence are NOT asserted. `evidence/ipc-main-handlers.json` records both drivers and the limited comparison scope explicitly.

A matching trace means handler-kernel contract equivalence on these scenarios, NOT unchanged-app compatibility, electron.mbt native IPC E2E, secure sender attestation or synchronous contextBridge. Existing facade/oracle/listener fixtures remain unchanged. The facade fixture now records handle registration; the full oracle still fails at the existing BrowserWindow gate.

## 4. Validation and remaining gates

1. `moon check --target js`; `moon test --target js`; `moon test --target native`.
2. `npm run build`; `npm test` on Linux and macOS, including `tests/ipc-handlers.test.cjs` and the complete prior suite.
3. macOS: `node scripts/ipc-handler-oracle.cjs <pinned-electron>`, existing listener oracle, unchanged baseline and full differential.
4. `linux-evidence/test-source.tar` plus `source-revision.txt` preserve the exact tracked CI source for replay with the separate compiled-core artifact. This excludes untracked workspace files.

No native sender authentication, production renderer ingress, `ipcRenderer`, `event.reply`, sync contextBridge, Node-less engine, real-app scenario, signing or packaging is enabled here. All M0 gates remain open; compatible:false and normal run/pack rejection remain unchanged. Independent review and local/native E2E must be reported separately from CI rather than inferred from tests.
