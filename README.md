# electron.mbt

MoonBit-first lightweight Electron runtime work, following [issue 0001](issues/open/0001-electron-compatible-lightweight-runtime.md).

**Status: M0 gates open; experimental macOS M1 native-window path runs an unchanged CommonJS fixture. NOT an Electron-compatible runtime release.** The isolated synchronous `contextBridge` remains unresolved. Standard `run` and `pack` still reject; a limited `run --experimental-m1` profile can load static HTML in a real WKWebView with no preload or renderer IPC. The design issue remains open.

## Implemented paths

| Path | What works now | What it does not prove |
| --- | --- | --- |
| `core/` | MoonBit lifecycle, monotonic handles, native-ack state, close/quit cancellation, document generations, grants, bounded requests, exactly-once terminal bookkeeping | Complete Electron event ordering, native sender authentication or a fully compatible desktop host |
| `bridge/` | Compiled MoonBit CJS exports, state and diagnostic contracts | A replacement of MoonBit lifecycle with handwritten JavaScript |
| `bridges/node/` | Real Node CJS module identity probe, bounded tiny-tree codec, source inventory, real private synchronous socketpair control calls | Full Electron BrowserWindow, general Structured Clone, preload or renderer IPC; experimental M1 uses a bounded private real macOS host |
| `platform/macos/` | An AppKit/WKWebView isolation probe and a standalone real-window host with create/load/show/destroy ACKs, cancellable native AppKit close events and bounded renderer-liveness signals | A synchronous function-proxy bridge, full sandbox audit, IME or accessibility acceptance |
| `fixtures/oracle/` | Unchanged main/preload/renderer fixture for a separately installed pinned Electron oracle | A matching electron.mbt execution or size improvement |
| `cmd/` | `snapshot`, MoonBit-backed `doctor` and static `compat-check` diagnostics | General Electron-compatible `run` or `pack`; explicit experimental M1 macOS run is separate |

Linux is used for contract and transport tests only. There is no Linux GUI backend. gpui.mbt is not linked yet and no other repository is modified.

## Build and test

1. Install the MoonBit toolchain and a real Node installation with matching Node-API headers. CI checks `moonc v0.10.14+7d59c7ec9` and `moon 0.1.20260920`; Node CI uses `24.21.0`. The leaf suite also runs on Node `22.16.0`. No npm dependencies are needed for the implementation.
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

4. On macOS with Xcode command-line tools and an available WindowServer, run:

   ```sh
   npm run probe:macos
   ```

   `node scripts/macos-probe.cjs --build-only` compiles but does not execute the probe. Non-macOS execution reports `NOT_RUN` and exits 2. The probe creates its own `dist/WKWorldProbe.app` and writes `evidence/wkcontentworld.json`; a PASS applies only to its listed world observations. It never reports contextBridge compatibility.

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

   See [experimental M1 native runner](docs/0002-native-host.md) for its exact supported and unsupported APIs, OS-close limitations, secure boundaries and evidence. This is a deliberately partial profile.

6. To collect a reference baseline, install Electron **44.7.0** separately, then pass its actual executable path:

   ```sh
   node scripts/oracle.cjs /absolute/path/to/Electron.app/Contents/MacOS/Electron
   ```

   The script requires the oracle's embedded Node to be **24.21.0**, creates a separate temporary userData directory, records event/value observations and fixture hashes in `evidence/electron-baseline.json`, and rejects changed sources. It does not download Electron or turn off Chromium's sandbox. CI explicitly installs the oracle outside the source tree for this test only; it is not a fallback or production dependency.

## CLI

```sh
node cmd/electron-mbt.cjs snapshot fixtures/cjs
node cmd/electron-mbt.cjs doctor fixtures/cjs
node cmd/electron-mbt.cjs compat-check fixtures/cjs
```

`snapshot` exits 0 on a successful inventory. `doctor` and `compat-check` currently exit 2 with `compatible:false` and `ELECTRON_MBT_M0_INCOMPLETE`; they inspect but never evaluate the app. Usage, I/O and missing-build failures exit 1. Unflagged `run` and `pack` exit 1 with the open M0 gate. Explicit `run <app-dir> --experimental-m1` is macOS-only and launches a limited native-host test profile without claiming Electron compatibility.

The inventory hashes files and symlink targets, bounds traversal and reads, rejects stable root escapes/cycles and detects some concurrent file changes. It is **not an atomic filesystem snapshot or a security boundary against an adversarial filesystem**. Run it on quiescent, trusted app sources. Privileged file-service authorization is not implemented.

## Boundaries

The tiny value profile rejects lossy values, accessors, proxies, sparse arrays, cycles and repeated object references. It is intentionally not Electron Structured Clone. JavaScript handles JS descriptors and module hooks; the lifecycle/authority/diagnostic implementation is MoonBit. The private C control transport accepts runtime-owned descriptors and serial calls only; it must not be exposed to renderers. Its watchdog is a transport failure detector, not an application IPC handler timeout.

[The machine-readable manifest](compatibility/manifest.json) keeps acceptance A–J partial/planned, with no verified compatibility rows. [Implementation progress and remaining work](docs/0001-progress.md) distinguish the probes from the production architecture. No release artifact, signing, Node bundle, size saving or complete crash/process ledger is claimed.
