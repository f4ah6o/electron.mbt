# Linux GTK/WebKitGTK native host (experimental)

Date: 2026-10-21 JST
Status: **experimental / partial. `compatible:false`, strict profile BLOCKED, original preload NOT_EXECUTED.**
Branch: `feat/linux-native-host-20261021`
Reference: `platform/macos/NativeHost.m` (macOS remains the reference implementation)

This document records the first Linux native backend slice. It is not a
supported Linux product backend and is not evidence for macOS/WebKit
compatibility. The MoonBit runtime in `native/nodeless` and
`runtime/app_runner` still owns lifecycle, identifiers, limits, policy and
document generations; the host is a native leaf that owns the actual GTK
window, WebView, snapshot files and private socketpairs.

## Scope

The host speaks the same private protocol as the macOS host for a bounded
subset:

| Operation | Supported behaviour |
| --- | --- |
| `hello`, `ready`, `shutdown` | session/version validation and bounded replies |
| `create-window` | one GTK window + `WebKitWebView`; no preload fields |
| `prepare-source` | schema-2 source manifest, SHA-256/bytes verification, private staged snapshot |
| `install-adapted-adapter` | generated page adapter source (max 64 KiB) |
| `begin-load` | document generation advance, script/pending-reply reset |
| `load-app-file` | `electron-mbt-app://app/...` snapshot load under the entry directory |
| `load-file` | bounded `file://` load under the app root |
| `get-web-contents-title` / `get-web-contents-url` | actual WebView title/URI |
| `get-window-title` / `set-window-title` | GTK window title |
| `probe-renderer` | fixed page-world probe (title, `#root` children, `window.api`, probes) |
| `get-adapted-status` | document-start adapter receipt and ingress release |
| `get-document-identity` | current URI + generation, not page claims |
| `get-ingress-status` | admitted/denied counters |
| `app-reply` | resolves/rejects the pending page `postMessage` Promise |
| `inject-app-request` | `ELECTRON_MBT_TEST_MODE=1` only; stale/current ingress selftest |
| `destroy-window` | stop load, fail pending replies, remove snapshot and window |
| `get-window-state` | `open`/generation diagnostic; used by hold mode after a user close |
| `main-read-file` / `main-write-file` | app sources, `.appData`/`.userData`, exact session-granted files; 256 KiB read/write; see [docs/0059](0059-linux-file-and-close.md) |
| `main-stat` | `exists`, `isFile`, `isDirectory`, `size`, `mtimeMs`, `denied` under the same read policy |
| `main-open-dialog` / `main-save-dialog` | real GTK file chooser on the main thread; exact-file readwrite (open) / write (save) grants; single selection |

`native/nodeless --window --hold [--hold-seconds 1..3600]` keeps the real window open and prints `HOLDING`/`HOLD_EXIT`; it is an interactive diagnostic, not a compatibility result. It is mutually exclusive with the selftest flags. A GTK window close ends the hold with `reason:"window-closed"`; `--hold-close-after-ms N` is the test-only close path.

Unknown operations fail with `ELECTRON_MBT_UNSUPPORTED_API`. Preload fields on
`create-window`, original preload, `contextBridge`, `ipcRenderer`, directory
grants/`main-read-dir`/`main-mkdir`, export/print, grant persistence and
revocation, menus, clipboard, IME/AX, `app.quit`/menu/tray and multi-window are
not implemented. Exact-file open/save and app-local main fs are implemented
with limits (see [docs/0059](0059-linux-file-and-close.md)); they are not a
directory broker or product compatibility.

## Shared fixtures that pass on Linux

A separate local boot harness also runs the pinned real Moji main and Vite
renderer on this Linux host; see [docs/0058](0058-moji-linux-boot.md). Exact-file
open/save, app-local main fs and a window close are implemented and recorded in
[docs/0059](0059-linux-file-and-close.md); directory grants, export, grant
persistence, human dialog selection and real human acceptance remain NOT RUN.

The following existing tests in `tests/nodeless-runtime.test.cjs` now run
against the Linux host when `dist/electron-mbt-native-host-linux` exists:

1. `a native window loads a page and reads its title without Node`
2. `a plain Node-less window reload advances the document generation`
3. `a Node-less adapted app serves modules and dispatches page API calls to QuickJS main`
4. `an adapted Node-less window reloads with a new generation and a fresh ingress`
5. `the Node-less ingress rejects a stale generation before Main dispatch`

The tests use the same `native/nodeless` CLI, the same source manifests and the
same generated adapter as the macOS path. Linux also runs its own exact-file fs,
open-dialog, save-dialog and window-close tests. The macOS-only directory/grant/
Malformed-frame/Moji tests and the human dialog selection remain skipped or NOT
RUN on Linux rather than being counted as PASS.

## Environment and commands

Recorded local environment:

| Item | Value |
| --- | --- |
| OS | Ubuntu 24.04, Linux 7.0.0 x86_64 |
| Display | X11 `DISPLAY=:10.0` |
| GTK | 3.24.41 |
| WebKitGTK | 4.1, 2.52.6 |
| Node | 24.22.0 (local; CI pin is 24.21.0) |
| MoonBit | 0.1.20261016 (local; CI pin is 0.1.20261012) |

```sh
node scripts/build-linux-host.cjs
npm run build
node --test tests/linux-host-frame.test.cjs
ELECTRON_MBT_REQUIRE_NATIVE_HOST=1 \
  DISPLAY=:10.0 GDK_BACKEND=x11 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 \
  node --test tests/nodeless-runtime.test.cjs
ELECTRON_MBT_REQUIRE_NATIVE_HOST=1 npm test
```

The CI counterpart is the `linux-native` job in `.github/workflows/ci.yml`. It
installs GTK/WebKitGTK development packages and Xvfb, builds the host, runs the
canonical-frame negative test and runs the shared Node-less suite under
`dbus-run-session` + `xvfb-run`. `ELECTRON_MBT_REQUIRE_NATIVE_HOST=1` makes a
missing host fail instead of silently skipping the five tests.

## Local result (2026-10-21)

| Command | Result |
| --- | --- |
| `node scripts/build-linux-host.cjs` | **PASS** (`gtk 3.24.41`, `webkitgtk 2.52.6`) |
| `node --test tests/linux-host-frame.test.cjs` | **PASS** (1 test; canonical/duplicate/trailing/session/oversize cases) |
| `ELECTRON_MBT_REQUIRE_NATIVE_HOST=1 node --test tests/nodeless-runtime.test.cjs` | **22 PASS / 0 FAIL / 20 SKIP**; five shared window tests, hold, close, exact-file fs, dialog plumbing, host-loss, read-only-dir fallback and slow-dialog timeout PASS |
| `npm test` (host present, pinned Moji source present) | **502 tests / 471 PASS / 0 FAIL / 31 SKIP** |
| `moon test --target js` | **145 PASS** |
| `moon test --target native` | **178 PASS** |
| Human Open/Save (single manual session) | **PASS** — opened `_build/markdown.md`, saved as `_build/Untitled.md` (4 bytes), reopened it; host exit 0; not a broad/automated acceptance result |

| CI `linux-native` | **PASS** — [run 39736298608](https://github.com/f4ah6o/electron.mbt/actions/runs/39736298608), head `836d5a9`, 1m55s; includes the 16-second slow-dialog test |
| CI `moonbit` | **PASS** — same run, 1m8s |
| CI `macos` | **PASS** — same run, 3m53s; the macOS suite exercises the macOS host, not this Linux host |

2026-10-23 update: the local suite is now **525 tests / 492 PASS / 0 FAIL / 33
SKIP** and `moon test` is **163 JS / 196 native PASS**. The Linux nodeless suite
is **22 PASS / 21 SKIP** because the real 16-second chooser test is gated on
`ELECTRON_MBT_ISOLATED_DISPLAY=1` and skips on an interactive desktop; the new
unmapped control-hold test covers the same 15-second host bound locally. The
native CLI parity suite is **12 PASS**, including the adapted native `dev`
window. macOS native execution and publication remain NOT RUN.
| readiness / G0–G4 | **unchanged NOT_READY**: 35 checks / 28 PASS / 2 FAIL / 5 NOT RUN; this slice adds no compatibility row or readiness PASS |

The first attempt exposed a WebKitGTK/JSC interaction: creating a private
`JSCContext` before WebKit initialisation stalled page loading in this build.
The host now creates its control JSON context after the WebKit context/security
setup and before the control threads, so pre-window main fs works and the
adapted page still loads. Pre-window `hello`/`ready` replies use a bounded
manual serializer. This is a Linux backend implementation note, not a macOS
contract change.

## Security boundaries and limits

- Control frames must be canonical: exact `version/session/request/window/generation/operation/payload`
  header, 32 lowercase hex session, bounded operation and payload, payload as
  the final member. Duplicate top-level identity keys, trailing bytes and
  oversize frames are rejected. A non-load operation on the load channel (or a
  load operation on the control channel) ends the session.
- The host stamps window/generation. Page-provided sender/window/generation
  claims are not authority.
- The page shim is document-start/top-frame only and deletes
  `__electronMbtIngress` after the adapter captures it. Page calls carry a
  per-document nonce that the host checks. WebKitGTK's UI-process API does not
  expose the macOS `WKScriptMessage.frameInfo.isMainFrame` equivalent, so
  **native main-frame sender/frame authority is NOT PROVEN** and Electron
  child-frame parity is not claimed. The malformed/frame-originated message
  test remains macOS-only.
- `prepare-source` verifies every manifest path, byte count and SHA-256, stages
  to a 0700 temporary directory with 0600 files, and rejects symlink/`..`
  escapes. The `electron-mbt-app` scheme serves only files under the entry
  directory; `../src/main.js` is denied as in the macOS host.
- Pending page replies are bounded to 128 and events to 1024. Oversized
  payloads are rejected. A full/broken event queue returns
  `ELECTRON_MBT_MAIN_BUSY` instead of dropping a pending request.
- `inject-app-request` is CLI/test-only and is not added to the QuickJS app
  allowlist.
- The host is a system GTK/WebKitGTK dependency; it does not bundle Electron,
  Chromium or Node. The tests put a fake `node` first on `PATH` and still pass.
- `show:false` native visibility is not implemented in this slice: the GTK
  window is realized/shown for loading and the reply records the requested
  `show` value. GTK window close is implemented; `app.quit`/menu/tray, focus,
  IME, accessibility and human dialog selection are NOT RUN.
- Exact-file grants are session-only and canonical. Directory subtrees,
  `main-read-dir`/`main-mkdir`, multi-select/filters, overwrite-confirmation UI
  and grant persistence/revocation are NOT implemented.

## Next increments

1. Keep the `linux-native` evidence artifact and update the run URL/head SHA
   when the job changes; the 2026-10-21 run is recorded above.
2. Address native frame/sender authority: document a profile restriction or
   find a WebKitGTK API that exposes the actual frame; do not infer it from a
   page nonce.
3. Add the directory picker/subtree grants, `main-read-dir`/`main-mkdir` and
   session grant persistence/revocation with bounded negative tests.
4. Implement export/print, `app.quit`/menu/tray, native visibility and focus.
5. Exercise the real Moji Open → edit → Save → Export flow with human input;
   keep it NOT RUN until recorded.
6. Keep macOS as the reference; do not substitute Linux GTK/WebKitGTK results
   for macOS/WebKit compatibility or for the strict profile.
