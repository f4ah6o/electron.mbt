# Node-less window and Moji main boot (G-2/G-3 partial)

Status: **partial**. A real AppKit/WKWebView window is created and loaded by the
Node-less main runtime through the native host, and the pinned Moji bundled main
boots on that runtime against a probe page. The original preload remains
**NOT EXECUTED**, file/update semantics are **import-only adaptations**, and
`compatible:false` / strict **blocked** remain. The real Moji renderer is now
booted separately; see [the adapted renderer boot](0044-nodeless-adapted-app-renderer.md).

## G-2: window path

`native/nodeless --window` starts `dist/electron-mbt-native-host` over inherited
socketpairs, performs `hello`/`ready`, installs the C host bridge into the
QuickJS context, and lets the app main use a bounded `electron.BrowserWindow`.

| operation | behavior |
| --- | --- |
| `new BrowserWindow(options)` | synchronous `create-window`; throws on host failure |
| `loadFile(path)` | `prepare-source` then `begin-load` + `load-file`; resolves after `didFinishLoad` |
| `getTitle` / `setTitle` | synchronous host get/set |
| `webContents.getTitle` / `getURL` | synchronous host queries |
| `ready-to-show`, `did-finish-load`, `closed` | bounded listener arrays; `ready-to-show` fires after load |
| `show` / `hide` / bounds / `isDestroyed` | local facade values; not native state |
| `destroy` / `close` | `destroy-window` and `closed` emission |
| `Menu.buildFromTemplate` / `setApplicationMenu` | bounded template model, no NSMenu installation |

Command:

```sh
moon build --target native native/nodeless
./_build/native/debug/build/native/nodeless/nodeless.exe \
  run fixtures/nodeless-window-app --window --entry src/main.js
```

Result (macOS arm64, 2026-10-19):

```json
{"schema":1,"probe":"nodeless-window-runtime","status":"PASS","engine":"quickjs-2026-06-04","profile":"electron-nodeless-adapted-v1","strict":"blocked","app":{"name":"nodeless-window-fixture","version":"1.0.0","entry":"src/main.js","modules":1,"manifestSha256":"def2037440f95f84a24b5a3e7d9c2ae670d2b6aa9373decf3b1650fd67fb864c"},"windowLoaded":true,"pageTitle":"nodeless-window-ready","mainError":"","lastRejection":"","hostPid":26599,"hostShutdown":true,"liveLeases":0,"nodeProcesses":0,"notVerified":["preload","real-renderer","fs-broker","updater-behavior","strict-contextBridge","asan","external-review"],"compatible":false}
```

## G-3: pinned Moji main boot

`node scripts/nodeless-moji-boot.cjs` verifies the pinned main/preload hashes
against `compatibility/apps/moji-v1.0.5/build-provenance.json`, builds a
temporary app with the real bundled main, a probe page and a source manifest,
and runs the Node-less window runtime with `--entry out/main/main.js`.

Result:

```json
{"status":"PASS","probe":"moji-nodeless-boot","mainSHA256":"41cd703c31002c0a80f3e6407f2743a93f60a686eb3084cd08cb98cf31f7046e","preloadSHA256":"bd0f47d61f79ffa68ebd1a65186d0afc477448ac8c3c911ac8d52aab5d38c544","bootGraphFiles":4,"mainEvaluated":true,"windowLoaded":true,"pageTitle":"moji-nodeless-ready","preloadExecuted":false,"rendererLoaded":false,"adaptedImports":["electron-updater","node:fs","node:fs/promises","node:zlib"],"lastRejection":"","liveLeases":0,"nodeProcesses":0,"compatible":false}
```

The report is stored at
[compatibility/reports/moji-nodeless-boot.json](../compatibility/reports/moji-nodeless-boot.json).

### Adapted imports (explicit, not Node parity)

| import | current behavior | open |
| --- | --- | --- |
| `node:fs` | import succeeds; `existsSync` returns false; `readFileSync` throws `ENOENT`; `writeFileSync` throws `EACCES` | real broker, grants, atomic-save contract |
| `node:fs/promises` | import succeeds; `readFile`/`writeFile` reject with `ENOENT`/`EACCES` | real async file broker and cancellation |
| `node:zlib` | import succeeds; `createDeflate` throws `ELECTRON_MBT_UNSUPPORTED_API` | real deflate/stream surface |
| `electron-updater` | import resolves to an import-only `autoUpdater` stub; no package resolution, network or update | profile-specific updater ADR or real implementation |

These are **adapted-profile** behaviors. They are not evidence that the original
Moji file, export, settings persistence or update flows work. A source hash match
does not make the adapted behavior equivalent to Electron/Node.

## Verification

| command | result |
| --- | --- |
| `moon build --target native native/nodeless` | PASS |
| window fixture | PASS |
| `node scripts/nodeless-moji-boot.cjs` | PASS (probe page) |
| `node --test tests/nodeless-runtime.test.cjs` | 6 PASS |
| `moon test --target native` | 176 PASS |
| `moon test --target js` | 145 PASS |
| `npm test` | 461 PASS |
| ASAN / ownership review / external audit | NOT RUN |

## Open G-2/G-3 gates

1. BrowserWindow options beyond size/title/show: `x/y`, min/max, parent/modal,
   transparent/offscreen, icon, `autoHideMenuBar`, bounds/DPI/focus and
   native show/hide state.
2. `webContents` navigation events, `will-navigate`, `setWindowOpenHandler`
   behavior, `send`, `executeJavaScript`, `printToPDF` and sender/event
   ordering.
3. `fs`/`fs/promises` broker with app/userData roots, grants, readback,
   atomic-replace metadata and failure/commit semantics.
4. `zlib` stream behavior and the PNG/PDF export paths.
5. Real Moji renderer asset loading and the adapted page adapter are covered by
   [the adapted renderer boot](0044-nodeless-adapted-app-renderer.md); the
   original preload/contextBridge remains the strict-profile gate.
6. Updater behavior; the Node-less renderer now uses a snapshot-scoped custom
   scheme (docs/0044), while the Node-backed probe still uses a test-only
   loopback server.
7. App scenario, process/resource ledger, signed release and Node-free audit of
   the packaged artifact.

`docs/0042` remains the main-runtime note; this document adds the window and
Moji-main probes without promoting any compatibility row.
