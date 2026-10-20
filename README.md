# electron.mbt

MoonBit-first lightweight Electron runtime work, following [issue 0001](issues/polished/0001-electron-compatible-lightweight-runtime.md).

**Status: M0 gates open; experimental macOS M1 native-window path runs an unchanged CommonJS fixture. NOT an Electron-compatible runtime release.** The implementation contains executable core contracts, admission inputs, feasibility probes and a constrained native host. Production isolated synchronous `contextBridge` remains unimplemented; a test-only B5 repaired-primitive spike recorded `go` on one macOS/WebKit build, B6-A added the MoonBit-owned exposure authority contract, B6-B an opt-in experimental preload bridge environment, B6-C an opt-in experimental synchronous transport E2E, B6-D an experimental semantics matrix and B6-E an evidence/review packet accepted by the project owner for B7 design work; B7 has started with a preload key/descriptor preview, pre-registered page admission and host expected-descriptor verification for a single arbitrary API key in the experimental M1 transport. The host reply is asynchronous and the M1 host is main-frame-only; the page shim now binds the actual descriptor to the preview metadata (bytes, function count, SHA-256) before materializing, so same-key descriptor mismatches fail closed for deterministic preloads; dynamic/non-deterministic preloads fail closed, and Electron-compatible child frames, the full fault matrix, the strict nodeless runtime and the profile remain blocked. An experimental Node-less main runtime now executes the pinned `fixtures/nodeless-app` CJS main on QuickJS with a bounded Node subset and `electron.app`/`ipcMain` facade. A separate `--window` mode creates a real AppKit/WKWebView window through the native host, advances a document generation on reload, rejects stale window/generation ingress events before Main dispatch, and denies malformed page messages; the adapter queue is released automatically when the load completes, while the explicit release control remains test-only. The pinned Moji bundled main now boots the real Vite renderer Node-lessly through a snapshot-scoped custom scheme and the generated page API; a main-realm `dialog.showOpenDialog` now opens a real NSOpenPanel with test-injected read grants, and `dialog.showSaveDialog` opens a real NSSavePanel and grants test-injected exact-file readwrite access for new or existing targets. Human save selection, overwrite confirmation, grant persistence and sheet-modal parenting remain NOT RUN. The original preload, main user-file grant persistence/human consent, production directory consent, production renderer dialog/consent, print-accurate export, update/zlib behavior and strict profile remain unexecuted/blocked. A host-backed main `fs`/`fs.promises` now reads app sources, atomically writes `.appData`/`.userData`, and uses session-scoped exact user-file grants from native panel completion or the explicit test scenario, and Moji settings persistence is verified. A bounded main-side directory/metadata surface now provides partial `fs.statSync`/`readdirSync`/`mkdirSync` and their `fs.promises` wrappers under the same host policy, and an explicit test scenario can grant a canonical directory subtree for bounded read/readwrite/write access. Those are not an Electron engine proxy, production profile or compatibility and M0 stays OPEN. Standard `run` and `pack` still reject; an explicit `run --experimental-m1` profile can load static HTML in a real WKWebView with no preload or renderer IPC. The design issues are organized under `issues/polished`; their runtime acceptance criteria remain unmet.

## Implemented paths

| Path | What works now | What it does not prove |
| --- | --- | --- |
| `core/` | MoonBit lifecycle, monotonic handles, B6-A exposure authority, native-ack state, close/quit cancellation, document generations, grants, bounded requests, exactly-once terminal bookkeeping, pinned-baseline and profile admission | Complete Electron event ordering, native sender authentication or a fully compatible desktop host |
| `bridge/` | Compiled MoonBit CJS exports, state/diagnostic contracts, host session bridge, `validate_baseline`, `validate_profile`, main-local IPC registries | A replacement of MoonBit lifecycle with handwritten JavaScript |
| `scripts/` | Bounded saved-baseline admission, probe-report validation, profile/manifest/evidence admission, app inventory/pruning/SBOM and governance validation, native-host smoke/fault, native-supervisor handshake/fault/retry harnesses and preview-readiness validation, G0–G4 gate reports and full state verification | Actual Electron, native, app or compatibility evidence by itself |
| `compatibility/` | Runtime profiles, evidence schema v2, app records for Moji/jmd, decision/risk/component ledgers; schema 1 manifest remains active | A verified profile, app scenario, SBOM or release |
| `bridges/node/` | Real Node CJS module identity probe, runtime-owned `electron` facade, main-local `ipcMain` listeners/handlers, isolated M1 app paths/single-instance lock, bounded invoke codec, source inventory, private socketpair and M1 runner | Renderer ingress/sender authentication, `ipcRenderer`, complete BrowserWindow/Menu, general Structured Clone or full Electron IPC |
| `platform/macos/` | AppKit/WKWebView feasibility probes plus a standalone real-window host with create/load/show/destroy ACKs, cancellable close events and bounded renderer-liveness signals | A synchronous function-proxy bridge, full sandbox audit, IME or accessibility acceptance |
| `bridges/embedded-js/` | Pinned QuickJS 2026-06-04 native ABI plus a bounded CJS loader and Node/Electron JS prelude: eval/throw, value leases, jobs, deadline interrupt, explicit destroy, module wrapper globals, host-backed `fs`/`fs.promises`, partial directory/metadata fs, session user-file and test-injected directory grants, main-realm `dialog.showOpenDialog` read grants and `dialog.showSaveDialog` readwrite grants | Grant persistence, human save selection/overwrite confirmation, production directory consent, `zlib`/updater, full Node subset, sanitizer/ownership review or strict preload compatibility |
| `runtime/embedded/` | Deterministic timer ownership, ordering, cancellation, limits and ref/deadline contract | QuickJS job/nextTick integration, host-event loop or Node timer parity |
| `runtime/modules/` | In-memory module registry, relative/package/node_modules resolver, and Node builtin classification/symbol policy | Node builtin shims, dynamic require, live package discovery/conditional exports or Node oracle parity |
| `runtime/runner/` | One QuickJS engine/context plus timer scheduler, job batches and pre-resolved CJS entry points | Native supervisor, host event loop, production process topology or app execution |
| `runtime/app_runner/` | Source-manifest admission, native SHA-256 verification, literal require graph, package `main`/`exports`, prelude dispatch, nextTick/jobs/timers, host-bridge install, app-root/`appData` main fs, partial directory/metadata fs, session user-file and test-injected directory grants, main open/save-dialog grants and explicit teardown | Native full event routing, human save selection/overwrite confirmation, grant persistence, production directory consent, original preload, ESM, dynamic require or app compatibility |
| `native/supervisor/` | MoonBit-native executable that spawns the real native host, creates/loads/destroys a window, reads one event notice, injects the generated adapted page API, resolves package.json main, runs a file-loaded linked-QuickJS fixture main with a local CJS graph and a node_modules/exports fixture, validates bootstrap status, applies its title and performs hello/ready/shutdown over inherited socketpairs | Random session/root validation, restart/faults, event/load routing, QuickJS ownership or app boot |
| `native/nodeless/` | Node-free CLI: pinned source manifest (text and binary assets), CJS main on QuickJS, bounded Node/Electron prelude, host-backed app-local `fs`/`fs.promises`, bounded directory/metadata fs, session user-file and test-injected directory grants, main `dialog.showOpenDialog` read grants and `dialog.showSaveDialog` readwrite grants with test-injected selections and a native open/save cancel smoke, main fixture selftest, real host-window mode (`BrowserWindow`/`loadFile`), snapshot-scoped custom app scheme, generated adapted page API, host-event pump, a pinned Moji real-renderer boot and a test-injected file/dialog/export broker E2E | Human save selection/overwrite confirmation, grant persistence, production directory consent, production `webContents`/dialogs/assets, real update/zlib behavior, original preload, strict profile or Electron compatibility |
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

   `moon test --target native` also compiles the vendored QuickJS core in `bridges/embedded-js/`; the pin and license are recorded in [vendor/quickjs/lock.json](vendor/quickjs/lock.json) and checked by `tests/quickjs-lock.test.cjs`. See [the QuickJS ABI note](docs/0009-quickjs-abi.md). The Node-less main runtime is built and run separately:

   ```sh
   moon build --target native native/nodeless
   ./_build/native/debug/build/native/nodeless/nodeless.exe run fixtures/nodeless-app
   ./_build/native/debug/build/native/nodeless/nodeless.exe run fixtures/nodeless-window-app --window --entry src/main.js
   ./_build/native/debug/build/native/nodeless/nodeless.exe run fixtures/nodeless-adapted-app --window --entry src/main.js
   node scripts/nodeless-moji-boot.cjs
   node scripts/nodeless-moji-app.cjs
   node scripts/nodeless-dialog-ui.cjs
   node --test tests/nodeless-runtime.test.cjs
   ```

   See [the Node-less main runtime note](docs/0042-nodeless-main-runtime.md), [the window/Moji-main probe](docs/0043-nodeless-window-and-moji-main-boot.md), [the Node-less adapted renderer boot](docs/0044-nodeless-adapted-app-renderer.md), [the test-injected broker E2E](docs/0045-nodeless-broker-e2e.md), [the main-side fs note](docs/0046-nodeless-main-fs.md), [the user-file grant note](docs/0047-nodeless-user-file-grants.md), [the directory/metadata fs note](docs/0048-nodeless-directory-fs.md), [the directory-grant note](docs/0049-nodeless-directory-grants.md), [the main open-dialog note](docs/0050-nodeless-main-dialog.md) and [the main save-dialog/write-consent note](docs/0051-nodeless-main-save-dialog.md).

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

   See [experimental M1 native runner](docs/0002-native-host.md) for its exact supported and unsupported APIs, OS-close limitations, secure boundaries and evidence. This is a deliberately partial profile. The separate `node scripts/m0-bridge-probe.cjs` diagnostic measures isolated-world native Promise replies and a deliberately **untrusted** DOM-event synchronous candidate over two real WKWebView documents. The B5 `node scripts/m0-context-bridge-probe.cjs` spike runs the unchanged oracle preload through a test-only synchronous shared-DOM/HMAC candidate and records a bounded go/no-go; it does not enable production `contextBridge` or the original preload. See [B5 spike results](docs/0038-m0-context-bridge-spike.md) and [M0 feasibility evidence](docs/0003-m0-contextbridge-feasibility.md).

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

The Node-less runtime now has a bounded host-window mode, a snapshot-scoped custom app scheme, the generated adapted page API and a pinned Moji real-renderer boot, a test-injected file/dialog/export broker E2E, a host-backed app-local main `fs`/`fs.promises` with atomic `.appData`/`.userData` writes, session-scoped exact user-file grants, a bounded directory/metadata surface, test-injected session-scoped directory grants, and main-realm `dialog.showOpenDialog`/`dialog.showSaveDialog` panels that issue test-injected read and exact-file readwrite grants. Human save selection and overwrite confirmation remain NOT RUN. It still has no original preload, grant persistence/human consent, production directory consent, production file/dialog consent, real update services or app compatibility claim. The custom scheme serves only staged snapshot files under the manifest entry's directory; custom-scheme `localStorage` was unavailable in the pinned Moji run and the fixture observed both outcomes across runs. The tiny value profile rejects lossy values, accessors, proxies, sparse arrays, cycles and repeated object references. It is intentionally not Electron Structured Clone. JavaScript handles JS descriptors and module hooks; the lifecycle/authority/diagnostic implementation is MoonBit. The private C control transport accepts runtime-owned descriptors and serial calls only; it must not be exposed to renderers. Its watchdog is a transport failure detector, not an application IPC handler timeout.

Saved baselines are admitted only when the compiled core confirms completion, the manifest Electron/Node pins, the current fixture hash, and a non-empty trace and measurement payload. Probe reports are admitted only when every executed candidate/trace carries its required observations; `NOT_RUN` and stalled entries need a reason and remain warnings, never acceptance evidence. Evidence bundles v2 require identity, profile, source, candidate, oracle, environment, execution, observations, verdict and integrity fields; cross-profile, stale, partial or `compatible:true` evidence is rejected. These are admission checks, not native or compatibility proof.

App inventory records are static-source records. Moji/jmd builds, boot traces and scenario results are `NOT_RUN` until an isolated build and native lane actually record them. The governance ledgers record unresolved license/signing/owner decisions as blocked; they do not make the project distributable.

[The machine-readable manifest](compatibility/manifest.json) keeps acceptance A–J partial/planned, with no verified compatibility rows. [Implementation progress and remaining work](docs/0001-progress.md) distinguish the probes from the production architecture. No release artifact, signing, Node bundle, size saving or complete crash/process ledger is claimed.

## Experimental macOS M1

The constrained native host is opt-in and macOS-only:

```sh
node scripts/build-macos-host.cjs
node cmd/electron-mbt.cjs run fixtures/m1-app --experimental-m1
```

It creates a real AppKit window and WKWebView, loads a static page and exposes a bounded CJS `app`/`BrowserWindow`/main-local `ipcMain` subset plus a main-local Menu template model. BrowserWindow position, minimum size and background colour are applied natively; `icon`/`autoHideMenuBar` are accepted but not applied. App paths and the single-instance lock are isolated under `ELECTRON_MBT_M1_USER_DATA_ROOT`; async app failures are reported as structured JSON. The Menu model does not install an NSMenu. The preload realm records unsupported APIs such as `contextBridge.exposeInMainWorld`; it has no renderer IPC, functional preload `contextBridge`/`ipcRenderer`, native menu identity or general Electron compatibility. Normal `run`/`pack` still reject. The host smoke, unchanged-CJS, invalid-wire, load-deadline, host-loss and load-event tests pass on the current macOS integration environment; Electron oracle bounds, renderer-crash/close simulators, interactive IME/AX and real-app acceptance remain NOT RUN.
