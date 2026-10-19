# Node-less main runtime (R2b/R3 first increment)

Status: **partial main-runtime increment**. A native CLI executes a bounded CJS
app main on the pinned QuickJS engine without a Node process, and the fixture
passes. The separate [window and Moji-main probe](0043-nodeless-window-and-moji-main-boot.md)
adds a real host window and a pinned Moji main boot against a probe page.
[The adapted renderer boot](0044-nodeless-adapted-app-renderer.md) extends the
same runtime to the real Moji Vite renderer through a snapshot-scoped custom
scheme and the generated page API. This is still not preload, strict
contextBridge, real file/dialog/export/update behavior or Electron acceptance;
`compatible:false`, strict **blocked** and adapted **partial** remain.

## What works

`native/nodeless` is a MoonBit-native executable. It reads a pinned
`source-manifest.json`, verifies every source hash with the native SHA-256 leaf,
builds the CJS graph in MoonBit, and evaluates it through
`bridges/embedded-js/cjs_loader` with a bounded Node/Electron prelude.

| area | verified |
| --- | --- |
| source admission | schema 2, relative paths, entry membership, per-file/total limits, SHA-256 mismatch rejection |
| module graph | literal `require` scan, relative paths, extension/index, JSON, nested/scoped `node_modules`, package `main` and require-selected `exports`, cache identity, cycles |
| CJS realm | `module.exports`, `exports` alias, `module.loaded`, `__filename`, `__dirname`, JSON modules, `require.resolve` fail-closed |
| Node subset | `path`, `url` file helpers, `process` (platform/arch/argv/env allowlist/versions/nextTick), `events.EventEmitter`, `Buffer` (utf8/base64/ascii, alloc/concat/subarray/equals), `setTimeout`/`clearTimeout`/Timeout ref/unref |
| adapted imports | host-required `fs`/`fs.promises` (app-root reads and `.appData`/`.userData` atomic writes when `--window`; user grants/streams open); `zlib` import-only with a typed `createDeflate` failure; `electron-updater` is an explicit import-only stub; computed require fails before evaluation |
| Electron facade | `app`, `ipcMain`, a bounded `BrowserWindow`/`webContents` and a local `Menu`/`screen`/`shell` model; dialog/contextBridge/ipcRenderer remain unsupported |
| scheduling | MoonBit scheduler owns deadlines; nextTick/Promise jobs are drained and the fixture observes tick → promise → timer; async handler settle uses a bounded 1000-step loop |
| teardown | live lease count is 0 and no pending job before context/runtime destruction |

## Commands

```sh
moon build --target native native/nodeless
./_build/native/debug/build/native/nodeless/nodeless.exe run fixtures/nodeless-app
./_build/native/debug/build/native/nodeless/nodeless.exe run fixtures/nodeless-window-app --window --entry src/main.js
node scripts/nodeless-moji-boot.cjs
node --test tests/nodeless-runtime.test.cjs
```

On Linux the binary is `_build/native/debug/build/native/nodeless/nodeless`
without the `.exe` suffix.

## Result (2026-10-19, macOS arm64)

`native/nodeless run fixtures/nodeless-app` exits 0 and emits one JSON line:

```json
{"schema":1,"probe":"nodeless-main-runtime","status":"PASS","engine":"quickjs-2026-06-04","profile":"electron-nodeless-adapted-v1","strict":"blocked","app":{"name":"nodeless-fixture","version":"1.0.0","entry":"src/main.js","modules":6,"manifestSha256":"fe9bf1244926e8cc0db4a0992cd0e9e585b0919da53539529691a9d525ce1474"},"results":{"selftest:report":{"ok":true,"result":{"app":"nodeless-fixture","version":"1.0.0","a":"a","b":"b","cycleA":"b","cycleB":"a","pkg":"package","data":"fixture","joined":"src/lib/a.js","b64":"aGk=","event":1,"nextTick":true,"fixtureEnv":null,"secretEnv":null}},"selftest:async":{"ok":true,"result":{"value":9}},"selftest:order":{"ok":true,"result":{"order":["tick","promise","timer"]}},"selftest:unsupported":{"ok":true,"result":{"code":"ELECTRON_MBT_HOST_UNAVAILABLE"}}},"liveLeases":0,"nodeProcesses":0,"notVerified":["preload","real-renderer","fs-broker","updater-behavior","strict-contextBridge","asan","external-review"],"compatible":false}
```

The fixture exercises cycle A↔B, package `exports`, JSON, Buffer, EventEmitter,
timer/nextTick ordering, `app.whenReady`, async Main handlers, env allowlisting
(`SECRET_TOKEN` is absent) and a host-required `fs` failure (`ELECTRON_MBT_HOST_UNAVAILABLE`) because this fixture runs without `--window`.

`tests/nodeless-runtime.test.cjs` additionally:

- runs with a fake `node` first in `PATH` (the runtime never invokes it);
- checks `otool -L`/`nm -u` on macOS (or `ldd`/`nm -D` on Linux) for
  `libnode`/Node-API symbols;
- rejects a manifest hash mismatch with
  `ELECTRON_MBT_NODELESS_SOURCE_HASH`;
- rejects a computed `require` with `ELECTRON_MBT_DYNAMIC_REQUIRE`;
- runs the app-local fs fixture and its symlink-escape negative on macOS.

## Limits and open gates

- The main-only fixture has no window. The separate window/Moji probe creates a
  real host window and `BrowserWindow`/`loadFile`, but bounds/show/hide state is a
  local facade, `webContents` events are bounded, and there is no dialog,
  renderer asset graph or production asset loader.
- `fs`/`fs.promises` are host-backed only in `--window` mode: they read under
  the app root and atomically write `.appData`/`.userData`. Main user-file
  grants outside the app root, directory/stream APIs and true async I/O are
  open; `zlib` remains import-only with a typed `createDeflate` failure
  (0008 R2b/R3, docs/0046).
- `electron-updater` is an explicit import-only `autoUpdater` stub; it performs
  no package resolution, network or update. The adapted behavior is recorded in
  `docs/0043` and is not Node/Electron parity.
- `url.URL`, `path.win32`, `require.resolve`, native modules, ESM, Node-API,
  network/stream/child_process and arbitrary npm are unsupported.
- The app-facing `path`/`url`/`Buffer`/`EventEmitter` algorithms are JS leaf
  glue; module resolution and policy stay in MoonBit. This is tested against a
  Node oracle but is not full Node parity.
- Dynamic require fails at graph build; it is not a general runtime loader.
- The require scanner is bounded and skips comments/strings/templates; it is
  not a full JS parser, so a regex literal can be a false positive and a
  require inside a template expression can be missed. Any undeclared runtime
  require still fails closed.
- The source manifest is not signed. Hashes detect mismatch against the
  manifest, not a malicious rewrite of both the manifest and the files; the
  reported manifest SHA-256 is evidence, not a trust anchor.
- ASAN/sanitizer runs, an independent ownership review and an external security
  audit are **NOT RUN**. `class` declarations are tested in the engine suite
  after fixing the undefined-text lease bug; no broader app-source matrix is
  claimed.
- The pinned Moji bundled main boots against a probe page, but the original
  preload, real renderer, update, save, dialog and app scenario remain open and
  no Electron compatibility row exists. Strict `electron-nodeless-v1` remains
  blocked.

## Verification split

| command | result |
| --- | --- |
| `moon build --target native native/nodeless` | PASS |
| `native/nodeless run fixtures/nodeless-app` | PASS |
| `node --test tests/nodeless-runtime.test.cjs` | 14 PASS |
| `moon test --target native` | 177 PASS |
| `moon test --target js` | 145 PASS |
| `npm test` | 469 PASS |
| sanitizer / ownership review / external audit | NOT RUN |

The reported `nodeProcesses:0` is self-reported by the runtime; the process and
binary audits are the independent checks. A passing main-runtime fixture is not
a Node-less app or release acceptance.
