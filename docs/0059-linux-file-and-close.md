# Linux exact-file open/save, main fs and window close

Date: 2026-10-21 JST
Status: **experimental, partial. `compatible:false`, strict BLOCKED, original preload NOT_EXECUTED.**
Host: [`docs/0057-linux-native-host.md`](0057-linux-native-host.md)
Moji boot evidence: [`docs/0058-moji-linux-boot.md`](0058-moji-linux-boot.md)

## Why this slice

The first Linux host booted Moji but had no main fs/dialog surface and ignored
the GTK close request. The user observed that Open/Save did nothing and the
window could not be closed. This slice adds the smallest useful exact-file
surface and a real GTK close path without claiming a file broker, directory
consent, export or compatibility.

## Implemented

### Window close

- The GTK `delete-event` now clears `window`/`web`/`manager`, fails pending
  replies and load requests, and lets GTK perform the default destroy. The host
  process stays alive long enough to answer `get-window-state` (`open:false`).
- `native/nodeless --window --hold` polls `get-window-state`; a user close ends
  the hold with `HOLD_EXIT` / `reason:"window-closed"` and exit 0.
- The `destroy-window` control still tears the window down programmatically.
- `--hold-close-after-ms N` is a test-only way to call `gtk_window_close` and
  exercise the same delete-event path. It is not a user API.
- `app.quit()` in the QuickJS prelude remains a flag-only no-op; native
  application quit/menu/tray semantics are still NOT IMPLEMENTED.

### Main fs (exact-file)

| Operation | Supported | Notes |
| --- | --- | --- |
| `main-read-file` | app sources, `.appData`/`.userData`, exact granted files | 256 KiB read limit; base64 reply |
| `main-write-file` | `.appData`/`.userData`, exact readwrite grants | 256 KiB write / 400 KiB base64 limit; `g_file_set_contents` replace |
| `main-stat` | same read policy | `exists`, `isFile`, `isDirectory`, `size`, `mtimeMs`, `denied` |
| `main-read-dir`, `main-mkdir` | **not implemented** | fail closed; no directory grants |
| grant persistence/revocation | **not implemented** | session-only exact-file grants |

The host resolves relative paths against the staged app root, canonicalizes
with `realpath`, and denies paths outside the app root/data roots unless the
canonical path has an exact session grant. A symlink to an outside file is
denied. Writes use `g_file_set_contents` (replace, not a CAS or
metadata-preserving atomic write). `.appData` and `.userData` are created 0700
at startup; no arbitrary parent directories are created for writes.

### GTK open/save dialogs

- `main-open-dialog` and `main-save-dialog` open a real `GtkFileChooserDialog`
  on the GTK main thread; the control request blocks until the dialog closes.
- Open grants the selected canonical file **read+write** for the session so an
  editor can save back to the file it opened. Save grants the selected exact
  file write access.
- Single selection only. `properties`/`filters`/button strings are accepted but
  multi-selection, filters, directory selection and sheet-modal parenting are
  not implemented. The save dialog enables overwrite confirmation.
- `ELECTRON_MBT_TEST_MODE=1` plus `ELECTRON_MBT_LINUX_DIALOG_AUTOSELECT=<path>`
  is a CI-only auto-selection hook; it drives the same chooser path.
- A human mouse/keyboard selection was observed once on 2026-10-22 on a
  workspace path (below); the overwrite-confirmation UI remains **NOT RUN**.

### JSC context ordering

The host now creates its private `JSCContext` after the WebKit context/security
setup, before the control threads. The original slice created it only after the
first `WebKitWebView` because an earlier context-before-WebKit order stalled
page loading on WebKitGTK 2.52.6. With this order, pre-window main fs (settings)
works and the adapted page still loads in the same run.

## Host-loss, GTK main-loop and read-only save hardening (2026-10-22)

The first manual file-dialog attempts exposed three lifecycle problems rather
than a file-grant failure:

- If the host closed while nodeless was writing an `app-reply`, the nodeless
  process died with **SIGPIPE**. Both the nodeless host client and the Linux
  host now ignore SIGPIPE; a broken control channel becomes `EPIPE`/host-loss
  (`HOLD_EXIT reason:"host-lost"`), not process death. Regression:
  `host loss during an explicit hold does not SIGPIPE the runtime`.
- The host control thread used the ordinary **15-second** request wait for
  `main-open-dialog`/`main-save-dialog`, while the client already waits one
  hour. A chooser left open for more than 15 seconds made the host `_exit(2)`,
  which looked like a crash. Dialog requests now use the same **3600-second**
  bound. Regression: a 16-second auto-selected chooser.
- A GTK close/dialog could make `gtk_main()` return; the host then used
  `_exit(2)` as a fail-closed path while a control request was still in flight.
  The host now re-enters the main loop and stays alive until the control thread
  completes the request and processes shutdown. A window close while a chooser
  is active cancels the chooser, then closes the window from an idle callback.
  `host_exit` records `status=... reason=...` under `ELECTRON_MBT_LINUX_DEBUG`.
- `g_file_set_contents` (atomic temp+rename) requires write permission on the
  parent directory even when the exact file is writable. The host now falls
  back to a direct exact-file write **only** for `EPERM`/`EACCES` parent
  permission failures. `EROFS` is reported as
  `ELECTRON_MBT_FILE_READ_ONLY` (prelude `EROFS`); other failures such as a full
  disk do not fall back and cannot truncate the file. Regression:
  `Linux main write falls back when the parent directory is read-only`.

The user's save target `/home/hirohito-fujita/Downloads/markdown.md` lives on a
read-only root mount in this environment (`findmnt`: `/ ... ro`). In-place save
therefore returns the explicit read-only error; the supported test path is a
writable workspace copy such as
`/home/hirohito-fujita/src/electron.mbt/_build/markdown.md`. This is an
environment boundary, not a grant bypass. A single manual Open/Save session on
a workspace path succeeded on 2026-10-22; it is not a broad or automated human
acceptance result.

## Automated evidence

Local Linux (Ubuntu 24.04, GTK 3.24.41, WebKitGTK 4.1 2.52.6, X11, Node
24.22.0, MoonBit 0.1.20261016; CI pins differ):

| Command | Result |
| --- | --- |
| `node scripts/build-linux-host.cjs` | **PASS** |
| `node --test tests/nodeless-runtime.test.cjs` with host | **22 PASS / 0 FAIL / 20 SKIP** |
| `npm test` with host and pinned Moji source | **502 tests / 471 PASS / 0 FAIL / 31 SKIP** |
| `tests/linux-host-frame.test.cjs` | **PASS** |
| `moon test --target js` / `native` | **145 / 178 PASS** |
| CI `linux-native` / `moonbit` / `macos` | **PASS** — [run 39736298608](https://github.com/f4ah6o/electron.mbt/actions/runs/39736298608), head `836d5a9`, 1m55s / 1m8s / 3m53s |

New Linux-only tests:

1. `Linux main fs reads app sources and writes userData without Node` — app
   source read, `.userData` write/read/stat, read `/etc/passwd` denied,
   write `src/main.js` and `.userData/../src/main.js` denied, oversize
   `EFBIG`, symlink escape denied.
2. `Linux main open dialog grants an exact file to the app` — real GTK chooser
   with CI auto-selection, read+write grant, read and write-back.
3. `Linux main save dialog grants an exact file and writes it` — real GTK save
   chooser with CI auto-selection and write grant.
4. `a native window close exits the explicit hold cleanly` — `gtk_window_close`
   through the test-only control, `HOLD_EXIT reason:"window-closed"`.
5. `Linux main open dialog survives beyond the ordinary 15-second control
   timeout` — a 16-second auto-selected chooser still completes.
6. Existing hold/five shared fixture tests remain PASS.

The pinned Moji boot report is `compatible:false`; the Moji main/renderer still
boot with `mainError:""`. The CI run above covers the fs/open/save/close tests;
the Moji boot harness itself remains local-only. A single human Open/Save
session on a workspace path is recorded above; it is not a broad acceptance
result and is not automated.

## Human Open/Save observation (2026-10-22)

One manual session on the repaired host (host exit 0, `reason=control_thread_main`)
produced the first real human Open/Save evidence:

- Open selected `/home/hirohito-fujita/src/electron.mbt/_build/markdown.md`
  through the real GTK chooser.
- Save As selected `/home/hirohito-fujita/src/electron.mbt/_build/Untitled.md`;
  the file contains 4 bytes (`aaaa`) and was written with the exact-file grant.
- The reopened document selected `_build/Untitled.md`; the user reported that it
  opened.
- The chooser stayed open beyond the old 15-second host bound. The host now uses
  the same 3600-second bound as the client, and the 16-second regression test
  covers that path.
- The host exited normally (`status=0`, `reason=control_thread_main`); there was
  no SIGPIPE, `_exit(2)`, or host-loss in this session.

This does **not** verify overwrite confirmation, filters, multi-select, export,
IME, restart, directory grants, settings persistence, or a second app/session.
The save used the writable workspace; `~/Downloads` remains on a read-only mount.
Settings writes to `.appData/moji/settings.json` were denied because the host
creates `.appData`/`.userData` but not arbitrary nested app-name directories;
the app continued and the user-visible Open/Save flow still worked. Settings
persistence therefore remains partial.

## NOT RUN / limits

- Overwrite-confirmation UI, keyboard shortcuts and sheet-modal parenting;
  broader human selection beyond the single workspace Open/Save session.
- Settings persistence for nested app-name directories (`.appData/moji`).
- Multi-selection, filters, open-directory, grant caps beyond one exact file.
- Directory grants, `main-read-dir`, `main-mkdir`, grant persistence/revocation.
- Export HTML/PDF/PNG, print-accurate rendering, updater/zlib behavior.
- `app.quit`, menu/tray, focus/visibility, IME/AX, packaging/signing.
- Native main-frame sender/frame authority; see
  [open issue 0022](../issues/open/0022-linux-native-frame-authority.md).
- macOS parity or product compatibility. Linux results are not macOS evidence.

`compatible:false` and strict BLOCKED remain. No profile, readiness or A–J row
is promoted.

## Next

1. Add directory grants + `main-read-dir`/`main-mkdir` only with an explicit
   directory picker and a bounded subtree policy.
2. Add session grant persistence/revocation with an atomic 0600 store.
3. Extend the manual Moji Open → edit → Save flow to Export and a second
   restart/session; basic workspace Open/Save/reopen is now observed once.
4. Implement `app.quit`/menu/tray and close/quit lifecycle semantics.
5. Keep resolving the frame authority issue 0022 separately.
