# electron.mbt

MoonBit-first lightweight Electron runtime work, following [issue 0001](issues/polished/0001-electron-compatible-lightweight-runtime.md).

**Status: M0 in progress, not an Electron-compatible runtime release.** The implementation contains executable core contracts and feasibility probes. It does not yet run or package an Electron app. In particular, isolated synchronous `contextBridge` is unresolved; `run` and `pack` fail explicitly before evaluating application code. The design issues are organized under `issues/polished`; their runtime acceptance criteria remain unmet.

## Implemented paths

| Path | What works now | What it does not prove |
| --- | --- | --- |
| `core/` | MoonBit lifecycle, monotonic handles, native-ack state, close/quit cancellation, document generations, grants, bounded requests, exactly-once terminal bookkeeping, pinned-baseline admission | Electron event ordering, native sender authentication or a connected desktop host |
| `bridge/` | Compiled MoonBit CJS exports, state and diagnostic contracts, structured window/document/request envelopes, `validate_baseline` | A handwritten JS replacement for the core |
| `scripts/` | Bounded saved-baseline admission and probe-report validation; missing/null/mistyped observations fail closed | Actual Electron, native, app or compatibility evidence by itself |
| `bridges/node/` | Real Node CJS module identity probe, runtime-owned `electron` facade declaring the app surface, bounded tiny-tree codec, source inventory, real private synchronous socketpair control calls | BrowserWindow, general Structured Clone, preload or renderer IPC |
| `platform/macos/` | An AppKit/WKWebView world-isolation probe with a deadline and machine-readable observations | A synchronous function-proxy bridge, full sandbox audit, IME or accessibility acceptance |
| `fixtures/oracle/` | Unchanged main/preload/renderer fixture for a separately installed pinned Electron oracle | A matching electron.mbt execution or size improvement |
| `cmd/` | `snapshot`, MoonBit-backed `doctor` and static `compat-check` diagnostics | Successful `run` or `pack` |

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

4. On macOS with Xcode command-line tools and an available WindowServer, run:

   ```sh
   npm run probe:macos
   ```

   `node scripts/macos-probe.cjs --build-only` compiles but does not execute the probe. Non-macOS execution reports `NOT_RUN` and exits 2. The probe creates its own `dist/WKWorldProbe.app` and writes `evidence/wkcontentworld.json`; a PASS applies only to its listed world observations. It never reports contextBridge compatibility. Reports with a missing required observation are invalid and exit 1. The default run does not read, write or copy the general clipboard; DOM clipboard read/write/copy and OS-level paste require `ELECTRON_MBT_OS_PASTE_OPT_IN=1` in a disposable environment.

5. To collect a reference baseline, install Electron **44.7.0** separately, then pass its actual executable path:

   ```sh
   node scripts/oracle.cjs /absolute/path/to/Electron.app/Contents/MacOS/Electron
   ```

   The script requires the oracle's embedded Node to be **24.21.0**, creates a separate temporary userData directory, records event/value observations and fixture hashes in `evidence/electron-baseline.json`, and rejects changed sources. It does not download Electron or turn off Chromium's sandbox. The compiled core validates the baseline before it is written, and `scripts/differential.cjs` validates a saved baseline before launching the candidate; incomplete, unpinned, source-mismatched or empty-observation baselines are rejected. CI explicitly installs the oracle outside the source tree for this test only; it is not a fallback or production dependency.

## CLI

```sh
node cmd/electron-mbt.cjs snapshot fixtures/cjs
node cmd/electron-mbt.cjs doctor fixtures/cjs
node cmd/electron-mbt.cjs compat-check fixtures/cjs
```

`snapshot` exits 0 on a successful inventory. `doctor` and `compat-check` currently exit 2 with `compatible:false` and `ELECTRON_MBT_M0_INCOMPLETE`; they inspect but never evaluate the app. Usage, I/O and missing-build failures exit 1. `run` and `pack` exit 1 with the open M0 gate instead of launching a reduced or insecure substitute.

The inventory hashes files and symlink targets, bounds traversal and reads, rejects stable root escapes/cycles and detects some concurrent file changes. It is **not an atomic filesystem snapshot or a security boundary against an adversarial filesystem**. Run it on quiescent, trusted app sources. Privileged file-service authorization is not implemented.

## Boundaries

The tiny value profile rejects lossy values, accessors, proxies, sparse arrays, cycles and repeated object references. It is intentionally not Electron Structured Clone. JavaScript handles JS descriptors and module hooks; the lifecycle/authority/diagnostic implementation is MoonBit. The private C control transport accepts runtime-owned descriptors and serial calls only; it must not be exposed to renderers. Its watchdog is a transport failure detector, not an application IPC handler timeout.

Saved baselines are admitted only when the compiled core confirms completion, the manifest Electron/Node pins, the current fixture hash, and a non-empty trace and measurement payload. Probe reports are admitted only when every executed candidate/trace carries its required observations; `NOT_RUN` and stalled entries need a reason and remain warnings, never acceptance evidence. These are admission checks, not native or compatibility proof.

[The machine-readable manifest](compatibility/manifest.json) keeps acceptance A–J partial/planned, with no verified compatibility rows. [Implementation progress and remaining work](docs/0001-progress.md) distinguish the probes from the production architecture. No release artifact, signing, Node bundle, size saving or complete crash/process ledger is claimed.
