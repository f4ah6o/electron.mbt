# Node-less adapted renderer boot (Moji)

Status: **partial adapted-app renderer boot**. The pinned Moji main and the real
Vite renderer now execute on `native/nodeless` without a Node process. The
generated page adapter is injected at document start, the page's `window.api`
calls cross the native host into QuickJS `ipcMain` handlers, and the real UI
renders. The original preload is **NOT_EXECUTED**; `compatible:false`, strict
**blocked** and adapted **partial** remain.

## What works

`native/nodeless --window` prepares a hash-verified source snapshot, creates a
real AppKit/WKWebView window, and loads the renderer through a snapshot-scoped
custom scheme:

| area | behavior |
| --- | --- |
| asset delivery | `electron-mbt-app://app/out/renderer/index.html` served from the staged snapshot; GET/HEAD only; no live-root reads; entry-directory boundary |
| module graph | Vite `type="module"` scripts, relative imports, CSS, fonts and images load over the custom scheme |
| adapted page API | manifest-listed `nodeless-app.json` points at the generated `page-api.js`; injected at document start in page world |
| page → main | page ingress → native `app-request` event → MoonBit event pump → `AppRunner.dispatch` → QuickJS `ipcMain.handle` → `app-reply` |
| main → page | fixed adapted topics remain page-local listeners; `release-adapted-ingress` flushes the bounded first-call queue after main handlers are ready |
| real renderer | Moji `out/renderer` (107 files; 113 admitted files including main, preload, adapter and sample) renders `New/Open/Save/Preview/Editor/Export`, `Moji v1.0.5`, `Open File`, `New File` |
| no Node | runtime child runs with a fake `node` first in `PATH`; no Node process or Node-API link is used |
| teardown | host shutdown succeeds, `liveLeases:0`, no pending page request at exit |

The renderer is loaded from the snapshot, not from the working tree. The source
manifest pins the main, preload, renderer, adapter, samples and profile by
SHA-256 and byte count. Binary renderer assets are admitted without being
treated as JavaScript source; native SHA-256 verification still covers them.

## App profile

Adapted apps add a manifest-listed file:

```json
{
  "schema": 1,
  "profile": "electron-nodeless-adapted-v1",
  "adapter": "adapted/page-api.js"
}
```

The adapter must be a relative path, present in the source manifest, and no
larger than 65,536 bytes. An invalid profile or adapter fails with
`ELECTRON_MBT_NODELESS_PROFILE` before main evaluation or window creation. A
missing profile preserves the plain Node-less window behavior.

## Commands

```sh
moon build --target native native/nodeless
node scripts/build-macos-host.cjs
./_build/native/debug/build/native/nodeless/nodeless.exe \
  run fixtures/nodeless-adapted-app --window --entry src/main.js
node scripts/nodeless-moji-app.cjs
node --test tests/nodeless-runtime.test.cjs
```

The deterministic fixture proves the full path without the external app source.
It loads a real ES module graph, checks that an asset outside the entry directory
is denied, checks custom-scheme `localStorage` availability, and resolves two
page API calls through QuickJS main. Expected page title:

```text
nodeless-adapted-ready-module-dark-idle-<storage|no-storage>-denied-scheme
```

## Result (2026-10-19, macOS arm64)

`node scripts/nodeless-moji-app.cjs` exits 0 and writes
[compatibility/reports/moji-nodeless-app.json](../compatibility/reports/moji-nodeless-app.json).
Key fields:

```json
{
  "status": "PASS",
  "probe": "moji-nodeless-app",
  "engine": "quickjs-2026-06-04",
  "profile": "electron-nodeless-adapted-v1",
  "strict": "blocked",
  "mainSHA256": "41cd703c31002c0a80f3e6407f2743a93f60a686eb3084cd08cb98cf31f7046e",
  "preloadSHA256": "bd0f47d61f79ffa68ebd1a65186d0afc477448ac8c3c911ac8d52aab5d38c544",
  "adapterSHA256": "bdfe8bddb4bc07389060e805464a554ff1b0a24d998a88512564c8a91dcc7501",
  "bootGraphFiles": 113,
  "pageURL": "electron-mbt-app://app/out/renderer/index.html",
  "pageTitle": "Moji v1.0.5",
  "rendererLoaded": true,
  "rootChildren": 1,
  "apiPresent": true,
  "adapted": {
    "observed": true,
    "released": true,
    "requests": 2,
    "replyErrors": 0,
    "ingress": { "admitted": 2, "denied": 0, "unhandled": 0 }
  },
  "preloadExecuted": false,
  "mainError": "",
  "lastRejection": "",
  "hostShutdown": true,
  "liveLeases": 0,
  "nodeProcesses": 0,
  "compatible": false
}
```

The report records hashes, the manifest SHA-256, 113 admitted files, the custom
page URL and the bounded page text containing the real UI labels. A source hash
mismatch exits 1 before any window is created.

## Deliberate limits

- The original preload is **NOT_EXECUTED**. `contextBridge`, `ipcRenderer`,
  `webUtils` and the general preload environment remain unimplemented; strict
  `electron-nodeless-v1` is still blocked.
- `fs`/`fs.promises` remain import-only (`ENOENT`/`EACCES`), `zlib` is
  import-only and `electron-updater` is an explicit import-only stub. Real
  file, save, dialog, export, update and zlib-stream behavior is not verified.
- The native host still owns `file:` operations. The Node-less runtime exposes
  no production grant/dialog control for them.
- The custom scheme is not a general origin or navigation surface. It serves
  only snapshot files under the manifest entry's directory and only the main
  frame; child frames, navigation, downloads, service workers and
  print-accurate export remain open.
- Custom-scheme `localStorage` was unavailable in the pinned Moji run and the
  deterministic fixture observed both available and unavailable outcomes across
  runs on the same WebKit build. Moji does not use it at boot; this is an
  adapted-profile limit, not a guarantee.
- The Moji renderer is booted programmatically. Human open/save/export,
  settings persistence, update interaction and visual/font acceptance are
  **NOT RUN**.
- The event pump handles queued page calls after main load. Event delivery
  during a blocked synchronous load, cancellation, per-handler deadlines and
  the full Electron event-ordering matrix remain open.
- The main, preload and adapter hashes are checked against the pinned build
  records. The generated source manifest pins every renderer file by SHA-256,
  but the build provenance's aggregate renderer tree hash was not independently
  re-derived by this harness.
- ASAN/sanitizer runs, an independent ownership review and an external security
  audit are **NOT RUN**.

## Verification split

| command | result |
| --- | --- |
| `moon build --target native native/nodeless` | PASS |
| `node scripts/build-macos-host.cjs` | PASS |
| `fixtures/nodeless-adapted-app` | PASS |
| `node scripts/nodeless-moji-app.cjs` | PASS |
| `node --test tests/nodeless-runtime.test.cjs` | 10 PASS |
| `moon test --target native` | 177 PASS |
| `moon test --target js` | 145 PASS |
| `npm test` | 465 PASS |
| `node scripts/m1-macos-smoke.cjs` | PASS |
| `node scripts/m1-source-snapshot.cjs` | PASS |
| `node scripts/nodeless-moji-boot.cjs` (probe page) | PASS |
| `node scripts/preview-readiness.cjs` | NOT_READY (exit 2, expected) |
| sanitizer / ownership review / external audit | NOT RUN |

This is a Node-less adapted renderer boot, not an Electron-compatible runtime
release or completion of issue 0008.
