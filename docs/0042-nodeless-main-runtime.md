# Node-less main runtime (R2b/R3 first increment)

Status: **partial main-runtime increment**. A native CLI executes a bounded CJS
app main on the pinned QuickJS engine without a Node process, and the fixture
passes. This is not a window, native-host, preload, Moji or Electron acceptance;
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
| fail-closed | `fs`, `fs/promises`, `zlib` throw typed unsupported; computed require fails before evaluation; `electron-updater` is rejected without an explicit adaptation |
| Electron facade | `app` (name/version/isPackaged/getAppPath/getPath/setPath/whenReady/isReady/on/quit) and `ipcMain` (handle/removeHandler/on/once) |
| scheduling | MoonBit scheduler owns deadlines; nextTick/Promise jobs are drained and the fixture observes tick → promise → timer; async handler settle uses a bounded 1000-step loop |
| teardown | live lease count is 0 and no pending job before context/runtime destruction |

## Commands

```sh
moon build --target native native/nodeless
./_build/native/debug/build/native/nodeless/nodeless.exe run fixtures/nodeless-app
node --test tests/nodeless-runtime.test.cjs
```

On Linux the binary is `_build/native/debug/build/native/nodeless/nodeless`
without the `.exe` suffix.

## Result (2026-10-19, macOS arm64)

`native/nodeless run fixtures/nodeless-app` exits 0 and emits one JSON line:

```json
{"schema":1,"probe":"nodeless-main-runtime","status":"PASS","engine":"quickjs-2026-06-04","profile":"electron-nodeless-adapted-v1","strict":"blocked","app":{"name":"nodeless-fixture","version":"1.0.0","entry":"src/main.js","modules":6,"manifestSha256":"f44664a235fa2b6375e5f8a6fae0dca6b890e872b3b0cb8fcce94af11dfdd51e"},"results":{"selftest:report":{"ok":true,"result":{"app":"nodeless-fixture","version":"1.0.0","a":"a","b":"b","cycleA":"b","cycleB":"a","pkg":"package","data":"fixture","joined":"src/lib/a.js","b64":"aGk=","event":1,"nextTick":true,"fixtureEnv":null,"secretEnv":null}},"selftest:async":{"ok":true,"result":{"value":9}},"selftest:order":{"ok":true,"result":{"order":["tick","promise","timer"]}},"selftest:unsupported":{"ok":true,"result":{"code":"ELECTRON_MBT_UNSUPPORTED_BUILTIN"}}},"liveLeases":0,"nodeProcesses":0,"notVerified":["window","native-host","preload","moji","strict-contextBridge","asan","external-review"],"compatible":false}
```

The fixture exercises cycle A↔B, package `exports`, JSON, Buffer, EventEmitter,
timer/nextTick ordering, `app.whenReady`, async Main handlers, env allowlisting
(`SECRET_TOKEN` is absent) and typed `node:fs` rejection.

`tests/nodeless-runtime.test.cjs` additionally:

- runs with a fake `node` first in `PATH` (the runtime never invokes it);
- checks `otool -L`/`nm -u` on macOS (or `ldd`/`nm -D` on Linux) for
  `libnode`/Node-API symbols;
- rejects a manifest hash mismatch with
  `ELECTRON_MBT_NODELESS_SOURCE_HASH`;
- rejects a computed `require` with `ELECTRON_MBT_DYNAMIC_REQUIRE`.

## Limits and open gates

- No native window/host, `BrowserWindow`, `webContents`, `loadFile`, dialog,
  shell, screen, menu or renderer. `native/nodeless` is a main-runtime probe,
  not the M1 host path.
- `fs`/`fs/promises`/`zlib` are import-fail-closed; the file broker, write
  semantics and zlib are open (0008 R2b/R3).
- `electron-updater` is not silently adapted; a profile-specific manifest/ADR
  is required before Moji can boot unchanged.
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
- No real Moji/jmd boot, update, save, dialog, renderer or app scenario, and no
  Electron compatibility row. Strict `electron-nodeless-v1` remains blocked.

## Verification split

| command | result |
| --- | --- |
| `moon build --target native native/nodeless` | PASS |
| `native/nodeless run fixtures/nodeless-app` | PASS |
| `node --test tests/nodeless-runtime.test.cjs` | 4 PASS |
| `moon test --target native` | 176 PASS |
| `moon test --target js` | 145 PASS |
| `npm test` | 459 PASS |
| sanitizer / ownership review / external audit | NOT RUN |

The reported `nodeProcesses:0` is self-reported by the runtime; the process and
binary audits are the independent checks. A passing main-runtime fixture is not
a Node-less app or release acceptance.
