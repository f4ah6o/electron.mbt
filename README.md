# electron.mbt

MoonBit-first lightweight Electron runtime work, following [issue 0001](issues/polished/0001-electron-compatible-lightweight-runtime.md).

**Status: M0 gates open; experimental macOS M1 native-window path runs an unchanged CommonJS fixture. NOT an Electron-compatible runtime release.** The implementation contains executable core contracts, admission inputs, feasibility probes and a constrained native host. The isolated synchronous `contextBridge` remains unresolved. Standard `run` and `pack` still reject; an explicit `run --experimental-m1` profile can load static HTML in a real WKWebView with no preload or renderer IPC. The design issues are organized under `issues/polished`; their runtime acceptance criteria remain unmet.

## Implemented paths

| Path | What works now | What it does not prove |
| --- | --- | --- |
| `core/` | MoonBit lifecycle, monotonic handles, native-ack state, close/quit cancellation, document generations, grants, bounded requests, exactly-once terminal bookkeeping, pinned-baseline and profile admission | Complete Electron event ordering, native sender authentication or a fully compatible desktop host |
| `bridge/` | Compiled MoonBit CJS exports, state/diagnostic contracts, host session bridge, `validate_baseline`, `validate_profile`, main-local IPC registries | A replacement of MoonBit lifecycle with handwritten JavaScript |
| `scripts/` | Bounded saved-baseline admission, probe-report validation, profile/manifest/evidence admission, app inventory and governance validation, native-host smoke/fault harnesses | Actual Electron, native, app or compatibility evidence by itself |
| `compatibility/` | Runtime profiles, evidence schema v2, app records for Moji/jmd, decision/risk/component ledgers; schema 1 manifest remains active | A verified profile, app scenario, SBOM or release |
| `bridges/node/` | Real Node CJS module identity probe, runtime-owned `electron` facade, main-local `ipcMain` listeners/handlers, bounded invoke codec, source inventory, private socketpair and M1 runner | Renderer ingress/sender authentication, `ipcRenderer`, complete BrowserWindow, general Structured Clone or full Electron IPC |
| `platform/macos/` | AppKit/WKWebView feasibility probes plus a standalone real-window host with create/load/show/destroy ACKs, cancellable close events and bounded renderer-liveness signals | A synchronous function-proxy bridge, full sandbox audit, IME or accessibility acceptance |
| `bridges/embedded-js/` | Pinned QuickJS 2026-06-04 native ABI: eval/throw, value leases, jobs, interrupt, explicit destroy | CJS loader, Node subset, sanitizer/ownership review, scheduler integration or a Node-less app |
| `runtime/embedded/` | Deterministic timer ownership, ordering, cancellation, limits and ref/deadline contract | QuickJS job/nextTick integration, host-event loop or Node timer parity |
| `runtime/modules/` | In-memory module registry: IDs, source hashes, states, dependency edges, limits | Filesystem resolution, Node builtins, dynamic require or Node oracle parity |
| `fixtures/oracle/` | Unchanged main/preload/renderer fixture for a separately installed pinned Electron oracle | A matching electron.mbt execution or size improvement |
| `cmd/` | `snapshot`, MoonBit-backed `doctor` and static `compat-check` diagnostics | General Electron-compatible `run` or `pack`; explicit experimental M1 macOS run is separate |

Linux is used for contract and transport tests only. There is no Linux GUI backend. gpui.mbt is not linked yet and no other repository is modified.

## Build and test

1. Install the MoonBit toolchain and a real Node installation with matching Node-API headers. CI checks `moonc v0.10.15+943464bfa` and `moon 0.1.20261012`; Node CI uses `24.21.0`. The leaf suite also runs on Node `22.16.0`. No npm dependencies are needed for the implementation.
2. Run the core checks and builds:

   ```sh
   moon check --target js
   moon test --target js
   moon test --target native
   npm run build
   ```

3. Run all Node tests, including the compiled MoonBit boundary:

   ```sh
   npm test
   ```

   `npm run test:leaf` runs only the native transport/loader/codec/manifest suite after `node scripts/build-native.cjs`. It is not a substitute for the MoonBit tests. A missing compiled core fails the complete suite rather than being silently skipped.

   `moon test --target native` also compiles the vendored QuickJS core in `bridges/embedded-js/`; the pin and license are recorded in [vendor/quickjs/lock.json](vendor/quickjs/lock.json) and checked by `tests/quickjs-lock.test.cjs`. See [the QuickJS ABI note](docs/0009-quickjs-abi.md).

4. On macOS with Xcode command-line tools and an available WindowServer, run:

   ```sh
   npm run probe:macos
   ```

   `node scripts/macos-probe.cjs --build-only` compiles but does not execute the probe. Non-macOS execution reports `NOT_RUN` and exits 2. The probe creates its own `dist/WKWorldProbe.app` and writes `evidence/wkcontentworld.json`; a PASS applies only to its listed world observations. It never reports contextBridge compatibility. Reports with a missing required observation are invalid and exit 1. The default run does not read, write or copy the general clipboard; DOM clipboard read/write/copy and OS-level paste require `ELECTRON_MBT_OS_PASTE_OPT_IN=1` in a disposable environment.

5. On macOS, compile the real host and execute its native smoke plus the unchanged CommonJS fixture:

   ```sh
   node scripts/build-macos-host.cjs
   node scripts/m1-macos-smoke.cjs
   node scripts/m1-app-smoke.cjs
   node scripts/m1-invalid-wire.cjs
   node scripts/m1-slow-load.cjs
   node scripts/m1-load-event-chain.cjs
   node scripts/m1-host-init-fault.cjs
   node scripts/m1-begin-load-failure.cjs
   node scripts/m1-load-deadline.cjs
   node scripts/m1-host-loss.cjs
   node scripts/build-macos-host.cjs --simulate-native-close
   node scripts/m1-native-close.cjs
   node scripts/m1-native-close-race.cjs
   node scripts/build-macos-host.cjs --simulate-webkit-termination
   node scripts/m1-renderer-delegate-sim.cjs
   node cmd/electron-mbt.cjs run fixtures/m1-app --experimental-m1
   ```

   See [experimental M1 native runner](docs/0002-native-host.md) for its exact supported and unsupported APIs, OS-close limitations, secure boundaries and evidence. This is a deliberately partial profile. The separate `node scripts/m0-bridge-probe.cjs` diagnostic measures isolated-world native Promise replies and a deliberately **untrusted** DOM-event synchronous candidate over two real WKWebView documents. It does not enable `contextBridge`; see [M0 feasibility evidence](docs/0003-m0-contextbridge-feasibility.md).

6. To collect a reference baseline, install Electron **44.7.0** separately, then pass its actual executable path:

   ```sh
   node scripts/oracle.cjs /absolute/path/to/Electron.app/Contents/MacOS/Electron
   ```

   The script requires the oracle's embedded Node to be **24.21.0**, creates a separate temporary userData directory, records event/value observations and fixture hashes in `evidence/electron-baseline.json`, and rejects changed sources. It does not download Electron or turn off Chromium's sandbox. The compiled core validates the baseline before it is written, and `scripts/differential.cjs` validates a saved baseline before launching the candidate; incomplete, unpinned, source-mismatched or empty-observation baselines are rejected. CI explicitly installs the oracle outside the source tree for this test only; it is not a fallback or production dependency.

## CLI

```sh
node cmd/electron-mbt.cjs snapshot fixtures/cjs
node cmd/electron-mbt.cjs doctor fixtures/cjs
node cmd/electron-mbt.cjs compat-check fixtures/cjs
node cmd/electron-mbt.cjs doctor fixtures/cjs --profile desktop-core-v1 --input-mode original-cjs --preload-mode original --runtime node-backed
```

`snapshot` exits 0 on a successful inventory. `doctor` and `compat-check` currently exit 2 with `compatible:false` and `ELECTRON_MBT_M0_INCOMPLETE`; they inspect but never evaluate the app. They accept an optional `--profile <id>` with `--input-mode`, `--preload-mode` and `--runtime`; unknown or mismatched profile tuples are rejected before app evaluation with a typed diagnostic. Usage, I/O and missing-build failures exit 1. Unflagged `run` and `pack` exit 1 with the open M0 gate. Explicit `run <app-dir> --experimental-m1` is macOS-only and launches a limited native-host test profile without claiming Electron compatibility.

Runtime profile admission is defined in [runtime-profiles-v1.json](compatibility/runtime-profiles-v1.json); the schema-1 [manifest](compatibility/manifest.json) remains the active compatibility matrix until the native CLI migration. [App records](compatibility/apps) are pinned source/build inputs with isolated build provenance; Moji typecheck/build and jmd build are PASS, but boot/first-use and native app scenarios are NOT RUN. They are not executed app results.

The inventory hashes files and symlink targets, bounds traversal and reads, rejects stable root escapes/cycles and detects some concurrent file changes. It is **not an atomic filesystem snapshot or a security boundary against an adversarial filesystem**. Run it on quiescent, trusted app sources. Privileged file-service authorization is not implemented.

## Boundaries

The tiny value profile rejects lossy values, accessors, proxies, sparse arrays, cycles and repeated object references. It is intentionally not Electron Structured Clone. JavaScript handles JS descriptors and module hooks; the lifecycle/authority/diagnostic implementation is MoonBit. The private C control transport accepts runtime-owned descriptors and serial calls only; it must not be exposed to renderers. Its watchdog is a transport failure detector, not an application IPC handler timeout.

Saved baselines are admitted only when the compiled core confirms completion, the manifest Electron/Node pins, the current fixture hash, and a non-empty trace and measurement payload. Probe reports are admitted only when every executed candidate/trace carries its required observations; `NOT_RUN` and stalled entries need a reason and remain warnings, never acceptance evidence. Evidence bundles v2 require identity, profile, source, candidate, oracle, environment, execution, observations, verdict and integrity fields; cross-profile, stale, partial or `compatible:true` evidence is rejected. These are admission checks, not native or compatibility proof.

App inventory records are static-source records. Moji/jmd builds, boot traces and scenario results are `NOT_RUN` until an isolated build and native lane actually record them. The governance ledgers record unresolved license/signing/owner decisions as blocked; they do not make the project distributable.

[The machine-readable manifest](compatibility/manifest.json) keeps acceptance A–J partial/planned, with no verified compatibility rows. [Implementation progress and remaining work](docs/0001-progress.md) distinguish the probes from the production architecture. No release artifact, signing, Node bundle, size saving or complete crash/process ledger is claimed.

## Experimental macOS M1

The constrained native host is opt-in and macOS-only:

```sh
node scripts/build-macos-host.cjs
node cmd/electron-mbt.cjs run fixtures/m1-app --experimental-m1
```

It creates a real AppKit window and WKWebView, loads a static page and exposes a bounded CJS `app`/`BrowserWindow` subset. It has no renderer IPC, preload, `contextBridge` or general Electron compatibility. Normal `run`/`pack` still reject. The host smoke, unchanged-CJS, invalid-wire, load-deadline, host-loss and load-event tests pass on the current macOS integration environment; Electron oracle bounds, renderer-crash/close simulators, interactive IME/AX and real-app acceptance remain NOT RUN.
