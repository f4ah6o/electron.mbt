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
- A human mouse/keyboard selection and the overwrite-confirmation UI remain
  **NOT RUN**.

### JSC context ordering

The host now creates its private `JSCContext` after the WebKit context/security
setup, before the control threads. The original slice created it only after the
first `WebKitWebView` because an earlier context-before-WebKit order stalled
page loading on WebKitGTK 2.52.6. With this order, pre-window main fs (settings)
works and the adapted page still loads in the same run.

## Automated evidence

Local Linux (Ubuntu 24.04, GTK 3.24.41, WebKitGTK 4.1 2.52.6, X11, Node
24.22.0, MoonBit 0.1.20261016; CI pins differ):

| Command | Result |
| --- | --- |
| `node scripts/build-linux-host.cjs` | **PASS** |
| `node --test tests/nodeless-runtime.test.cjs` with host | **19 PASS / 0 FAIL / 20 SKIP** |
| `npm test` with host and pinned Moji source | **499 tests / 468 PASS / 0 FAIL / 31 SKIP** |
| `tests/linux-host-frame.test.cjs` | **PASS** |
| `moon test --target js` / `native` | **145 / 178 PASS** |
| CI `linux-native` / `moonbit` / `macos` | **PASS** — [run 39547063739](https://github.com/f4ah6o/electron.mbt/actions/runs/39547063739), head `ce09857`, 1m42s / 54s / 3m43s |

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
5. Existing hold/five shared fixture tests remain PASS.

The pinned Moji boot report is `compatible:false`; the Moji main/renderer still
boot with `mainError:""`. The CI run above covers the fs/open/save/close tests;
the Moji boot harness itself remains local-only. The open/save **human** flow in Moji has not been
recorded as a human acceptance result; the dialog plumbing is covered by the
auto-selection tests and the user can now try the real buttons.

## NOT RUN / limits

- Human dialog selection, overwrite-confirmation UI, keyboard shortcuts and
  sheet-modal parenting.
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
3. Exercise the real Moji Open → edit → Save → Export flow with human input;
   record NOT RUN until it passes.
4. Implement `app.quit`/menu/tray and close/quit lifecycle semantics.
5. Keep resolving the frame authority issue 0022 separately.
