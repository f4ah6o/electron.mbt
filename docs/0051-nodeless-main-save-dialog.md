# Node-less main save dialog and write consent

Status: **partial main save-dialog increment**. The trusted QuickJS main can
call `dialog.showSaveDialog` and receive one canonical path. A real
`NSSavePanel` selection or a CLI test-injected result becomes a session-scoped
**read+write** grant for that exact file in the existing main `fs` registry.
Canceling grants nothing and does not mutate the registry. The Promise API is
provided, but the private host call blocks the QuickJS main until the panel
closes; this is an explicit adapted behavior, not Electron's non-blocking
dialog semantics. Human save selection, overwrite confirmation, extension
appending, sheet-modal parenting, persistence and revocation remain open.
`compatible:false`, adapted **partial**, strict **blocked** and the original
preload **NOT_EXECUTED** are unchanged.

## What works

`--window` installs the private host bridge before main evaluation. The main
prelude exposes:

| API | Behavior |
| --- | --- |
| `dialog.showSaveDialog(options)` | Parentless AppPrincipal dialog; returns `Promise<{canceled, filePath}>` |
| `dialog.showSaveDialog(parent, options)` | Accepts a live `BrowserWindow`; the parent must not be destroyed. The native panel is app-modal, not sheet-attached. |
| `showOpenDialogSync`, `showSaveDialogSync`, `showMessageBox`, `showMessageBoxSync`, `showErrorBox` | Throw `ELECTRON_MBT_UNSUPPORTED_API`; the async open/save APIs are the only dialog entry points |

Accepted options:

| Option | Contract |
| --- | --- |
| `defaultPath` | Absolute path ≤4096, **or** a bare file name ≤255 with no `/` and not `.`/`..`. Display hint only: it never grants anything. |
| `filters` | Bounded `{name, extensions}` list; `*` removes the extension restriction; names are validated but macOS does not display Electron filter names |
| `properties` | Array ≤5; only `showOverwriteConfirmation` is accepted because `NSSavePanel` always confirms replacement. Every other property, and any other value shape, fails closed. |
| `title`, `buttonLabel` | Bounded strings ≤256 mapped to the native panel title/prompt |
| any other key | `ELECTRON_MBT_UNSUPPORTED_API`; never silently ignored |

The host operation `main-save-dialog` is in the QuickJS allowlist. The
CLI-only controls `set-main-save-dialog-results` and
`get-main-save-dialog-status` are outside the allowlist, so app code receives
`ELECTRON_MBT_HOST_REQUEST_DENIED`.

Return shape:

| Case | Value |
| --- | --- |
| canceled | `{canceled: true, filePath: undefined}` (the `filePath` key exists; its value is `undefined`) |
| confirmed | `{canceled: false, filePath: "<canonical absolute path>"}` |
| invalid options | Promise rejects `EINVAL` / `ELECTRON_MBT_UNSUPPORTED_API` |
| destroyed parent | `ELECTRON_MBT_WINDOW_DESTROYED` before the host |
| missing host bridge | `ELECTRON_MBT_HOST_UNAVAILABLE` |

## Grants

| Selection | Granted access | Readable/writable with `fs` | Denied |
| --- | --- | --- | --- |
| new file (existing parent) | exact-file readwrite bit | `writeFileSync`, `readFileSync`, `statSync`, `fs.promises` variants | sibling paths, parent `readdir`, `mkdir` next to it, missing-parent targets |
| existing regular file | exact-file readwrite bit | overwrite, read back, stat | directory operations, sibling paths |
| directory | none (`EISDIR`) | — | — |
| special file | none (`EISDIR`) | — | — |
| dangling symlink | none (`ELECTRON_MBT_DIALOG_SELECTION`) | — | — |
| symlink to a regular file | readwrite on the resolved target | target read/write/stat | the link path is not a separate grant |
| canceled | none | — | the would-be target, including pre-created cancel targets |
| registry full (64 files) | none (`EFBIG`) | — | no partial grant |

A save selection grants read+write because Electron's save path is used for
overwrite/read-back flows (the existing renderer broker already grants
`readwrite` for save panels). It deliberately does **not** grant the parent
directory, so listing and mkdir remain denied.

## Policy and bounds

| Item | Value |
| --- | --- |
| selections per call | exactly one file (save dialogs return one path) |
| path length | 4,096 UTF-16 code units, no NUL, absolute |
| target types | regular file, or a new path with an existing parent directory |
| canonicalization | `realpath` where the target exists; nearest existing ancestor plus the missing components for a new file; dangling symlinks rejected |
| filesystem root | `/` rejected |
| filters | 16 filters, 32 extensions each, extension length 1–16 |
| title/button label | 256 |
| default path | 4,096 code units absolute, or a 255-code-unit bare name |
| dialog wait | 3,600 seconds, then the host request fails closed |
| test scenario payload | must fit the existing 8 KiB control-request copy bound |
| grant tables | reuses the 64 exact-file and 16 directory session registries |
| lifetime | host session; no persistence, revocation or migration |

The save path validates the target before touching the registry, so a failure
(directory, missing parent, dangling symlink, cap, malformed path) cannot leave
a partial write capability behind. Selecting the same path twice merges the
bits into one registry entry.

## Privilege separation

The QuickJS app main is trusted app code, but it can only request a panel. It
cannot mint a grant for an arbitrary path: only a real panel result or the
CLI-only test queue can authorize a selection. `defaultPath` is display-only.
The page/renderer realm cannot reach `dialog`, the private host bridge, or the
grant tables. The test-only `ELECTRON_MBT_TEST_NATIVE_HOST` override requires
`ELECTRON_MBT_TEST_MODE=1` and a `dist/` relative path.

## Error mapping

| host code | main realm |
| --- | --- |
| `ELECTRON_MBT_FILE_DENIED` | `EACCES` |
| `ELECTRON_MBT_FILE_NOT_FOUND` | `ENOENT` |
| `ELECTRON_MBT_FILE_LIMIT` | `EFBIG` |
| `ELECTRON_MBT_FILE_TYPE` | `EISDIR` |
| `ELECTRON_MBT_FILE_NOT_DIR` | `ENOTDIR` |
| `ELECTRON_MBT_INVALID_ENVELOPE` | `EINVAL` |
| `ELECTRON_MBT_NATIVE_FAILURE` / `ELECTRON_MBT_HOST_RESPONSE` | `EIO` |
| `ELECTRON_MBT_FILE_DIALOG_UNAVAILABLE` | `ELECTRON_MBT_DIALOG_UNAVAILABLE` |
| `ELECTRON_MBT_DIALOG_SELECTION` | `ELECTRON_MBT_DIALOG_SELECTION` |
| `ELECTRON_MBT_WINDOW_DESTROYED` | `ELECTRON_MBT_WINDOW_DESTROYED` |
| missing host bridge | `ELECTRON_MBT_HOST_UNAVAILABLE` |
| non-allowlisted host operation | `ELECTRON_MBT_HOST_REQUEST_DENIED` |

A malformed host reply is `EIO`; unsupported options, properties and APIs are
`ELECTRON_MBT_UNSUPPORTED_API`.

## Deterministic fixture

`fixtures/nodeless-dialog-app` creates one window and registers:

- `dialog:save-selftest`, which exercises a new file (write/read/stat/rewrite),
  an existing-file overwrite, exact-file denials (sibling read/write, parent
  `readdir`, `mkdir`), cancel (`filePath` undefined and no grant), default-path
  shapes, invalid/unsupported options, directory/missing-parent/dangling-symlink
  rejections, the filesystem root, duplicate-target merge, the live/destroyed
  parent overload, the 64-file cap (`EFBIG`), and hostile test-control calls;
- `dialog:save-ui-selftest`, which calls one real-panel save and returns the
  cancel result. `dialog:ui-selftest` (open) is unchanged and both run in the
  same `--dialog-ui-selftest` session.

The contract tests copy the fixture, create the temp targets (including a space
and a non-ASCII name), write `nodeless-save-dialog.json`, regenerate the
manifest, and run:

```sh
nodeless.exe run <temp-app> --window --save-dialog-selftest --entry src/main.js
```

The cap test pre-grants 64 files and expects the 65th save target to return
`EFBIG` without creating the file. The UI smoke builds a test-only host with
`--simulate-main-dialog-cancel`, opens `NSOpenPanel` then `NSSavePanel`, cancels
both from a timer in `NSModalPanelRunLoopMode`, and writes
`compatibility/reports/nodeless-dialog-ui.json`.

## Verification

Environment: macOS 26.5.2 arm64, Node 24.22.0, pinned QuickJS 2026-06-04,
`dist/electron-mbt-native-host` rebuilt from the same tree.

| command | result |
| --- | --- |
| `moon build --target native native/nodeless` | PASS |
| `node scripts/build-macos-host.cjs` | PASS |
| `node scripts/build-macos-host.cjs --simulate-main-dialog-cancel` | PASS |
| `node --test tests/nodeless-runtime.test.cjs` | 26 PASS |
| `moon test --target js` | 145 PASS |
| `moon test --target native` | 178 PASS |
| `node scripts/nodeless-dialog-ui.cjs` | PASS (open+save open/cancel; selection false) |
| `node scripts/nodeless-moji-app.cjs` | PASS |
| `node scripts/nodeless-moji-boot.cjs` | PASS |
| `npm test` | 481 PASS |
| `node scripts/preview-readiness.cjs` | NOT_READY (34 checks, 27 PASS, 2 FAIL, 5 NOT RUN; expected exit 2) |
| `node scripts/verify-state.cjs` | NOT_READY |
| ASAN / ownership review / external audit | NOT RUN |

## Limits

- the Promise is backed by a blocking private host call; main timers and jobs
  do not run while the panel is open, concurrent dialogs are serialized, and
  the native host control lane is occupied until the panel closes;
- the panel is app-modal; a parent overload is accepted but not sheet-attached;
- overwrite confirmation is NSSavePanel's native prompt and is **NOT RUN**
  without human interaction; extension appending is native behavior and is not
  asserted by the test-injected path;
- the test-injected selection is contract evidence, not human-consent evidence;
  real human save selection is **NOT RUN**;
- a dead client can leave the host in `runModal` until the panel closes or the
  one-hour bound expires;
- grants are session-scoped; there is no persistence, revocation UI, policy
  migration or directory implication;
- canonicalization is checked when the selection is granted, so a trusted-main
  TOCTOU window remains between the grant and later `fs` use;
- a symlink selected through the panel grants its resolved target, not the link
  path; replacing the target after the grant is not detected;
- the original preload/contextBridge, renderer production dialog/write consent,
  print-accurate export, updater/zlib behavior and strict profile remain open.

This is a main save-dialog write-consent increment for the Node-less adapted
profile, not an Electron-compatible runtime release.
