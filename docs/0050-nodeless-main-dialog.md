# Node-less main open dialog

Status: **partial main-dialog increment**. The trusted QuickJS main can call
`dialog.showOpenDialog` and receive canonical file/directory paths. A real
`NSOpenPanel` selection or a CLI test-injected result becomes a session-scoped
**read-only** grant in the existing main `fs` registry. The Promise API is
provided, but the private host call blocks the QuickJS main until the panel
closes; this is an explicit adapted behavior, not Electron's non-blocking dialog
semantics. Human selection, write consent, sheet-modal parenting, save dialogs,
persistence and revocation remain open. `compatible:false`, adapted **partial**,
strict **blocked** and the original preload **NOT_EXECUTED** are unchanged.

## What works

`--window` installs the private host bridge before main evaluation. The main
prelude now exposes:

| API | Behavior |
| --- | --- |
| `dialog.showOpenDialog(options)` | Parentless AppPrincipal dialog; returns `Promise<{canceled, filePaths}>` |
| `dialog.showOpenDialog(parent, options)` | Accepts a live `BrowserWindow`; the parent must not be destroyed. The native panel is app-modal, not sheet-attached. |
| `dialog.showOpenDialogSync`, `showSaveDialog`, `showSaveDialogSync`, `showMessageBox`, `showMessageBoxSync`, `showErrorBox` | Throw `ELECTRON_MBT_UNSUPPORTED_API`; no empty success |

Accepted options:

| Option | Contract |
| --- | --- |
| `properties` | `openFile`, `openDirectory`, `multiSelections`; defaults to `['openFile']`; at least one of `openFile`/`openDirectory` is required |
| `filters` | Bounded `{name, extensions}` list; `*` removes the extension restriction; names are validated but macOS does not display Electron filter names |
| `defaultPath` | Absolute path used only as the panel starting directory; it grants nothing and a missing path is ignored |
| `title`, `buttonLabel` | Bounded strings mapped to the native panel title/prompt |
| any other key | `ELECTRON_MBT_UNSUPPORTED_API`; never silently ignored |

The host operation `main-open-dialog` is in the QuickJS allowlist. The
CLI-only controls `set-main-dialog-results` and `get-main-dialog-status` are
outside the allowlist, so app code receives
`ELECTRON_MBT_HOST_REQUEST_DENIED`.

## Grants

| Selection | Granted access | Readable with `fs` | Denied |
| --- | --- | --- | --- |
| regular file | exact-file read bit | `statSync`, `existsSync`, `readFileSync`, `fs.promises.readFile` | `writeFileSync`, write-through-Promise, sibling paths |
| directory | subtree read bit | `statSync`, `readdirSync`, `readFileSync` on descendants | `writeFileSync`, `mkdirSync`, sibling/prefix paths, `/` |
| canceled | none | none | all selected/other paths |

Grants are session-scoped, survive a renderer reload and clear on host
shutdown. They are never persisted across restarts and there is no revocation
UI. Open selection deliberately does not imply write consent; a future save
dialog or explicit write path is required.

## Policy and bounds

| Item | Value |
| --- | --- |
| selections per call | 16 (a 17th path fails `EFBIG`; no earlier path is granted) |
| path length | 4,096 UTF-16 code units, no NUL, absolute |
| duplicate canonical paths | rejected (`ELECTRON_MBT_DIALOG_SELECTION`) |
| selection types | regular file or directory; special files rejected |
| canonicalization | `realpath`; symlinks resolve to the target; escaping paths are not granted |
| grant tables | reuses 64 exact-file and 16 directory grants per host session |
| root directory | `/` rejected as a directory grant |
| filters | 16 filters, 32 extensions each, extension length 1–16 |
| title/button label | 256 |
| dialog wait | 3,600 seconds, then the host request fails closed |
| test scenario payload | must fit the existing 8 KiB control-request copy bound |
| lifetime | host session; no persistence, revocation or migration |

The shared grant helper validates every path, requested mode and capacity in
local copies of `mainFileGrants`/`mainDirectoryGrants`, and swaps the tables
only after the whole selection passes. A type mismatch, duplicate, over-limit
selection, or path failure therefore grants nothing.

## Privilege separation

The QuickJS app main is trusted app code, but it can only request a panel. It
cannot mint a grant for an arbitrary path: only a real panel result or the
CLI-only test queue can authorize selections. `defaultPath` is display-only.
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
| `ELECTRON_MBT_INVALID_ENVELOPE` | `EINVAL` |
| `ELECTRON_MBT_NATIVE_FAILURE` / `ELECTRON_MBT_HOST_RESPONSE` | `EIO` |
| `ELECTRON_MBT_FILE_DIALOG_UNAVAILABLE` | `ELECTRON_MBT_DIALOG_UNAVAILABLE` |
| `ELECTRON_MBT_DIALOG_SELECTION` | `ELECTRON_MBT_DIALOG_SELECTION` |
| `ELECTRON_MBT_WINDOW_DESTROYED` | `ELECTRON_MBT_WINDOW_DESTROYED` |
| missing host bridge | `ELECTRON_MBT_HOST_UNAVAILABLE` |
| non-allowlisted host operation | `ELECTRON_MBT_HOST_REQUEST_DENIED` |

A malformed host reply is `EIO`; unsupported options and APIs are
`ELECTRON_MBT_UNSUPPORTED_API`.

## Deterministic fixture

`fixtures/nodeless-dialog-app` creates one window and registers:

- `dialog:selftest`, which exercises parentless multi-file, parent directory,
  mixed file/directory, cancel, type mismatch, multiple paths without
  `multiSelections`, 17-path `EFBIG`, duplicate paths, 16-path success,
  unsupported options, destroyed parent, and hostile test-control calls;
- `dialog:ui-selftest`, which calls one real-panel open and returns the result.

The contract test copies the fixture, creates temp files/directories (including
a space and a non-ASCII name), writes `nodeless-dialog.json`, regenerates the
manifest, and runs:

```sh
nodeless.exe run <temp-app> --window --dialog-selftest --entry src/main.js
```

The UI smoke builds a test-only host with `--simulate-main-dialog-cancel`,
opens the real NSOpenPanel, cancels it from a timer in
`NSModalPanelRunLoopMode`, and writes
`compatibility/reports/nodeless-dialog-ui.json`.

## Verification

Environment: macOS 26.5.2 arm64, Node 24.22.0, pinned QuickJS 2026-06-04,
`dist/electron-mbt-native-host` rebuilt from the same tree.

| command | result |
| --- | --- |
| `moon build --target native native/nodeless` | PASS |
| `node scripts/build-macos-host.cjs` | PASS |
| `node scripts/build-macos-host.cjs --simulate-main-dialog-cancel` | PASS |
| `node --test tests/nodeless-runtime.test.cjs` | 23 PASS |
| `moon test --target js` | 145 PASS |
| `moon test --target native` | 178 PASS |
| `node scripts/nodeless-dialog-ui.cjs` | PASS (open/cancel; selection false) |
| `node scripts/nodeless-moji-app.cjs` | PASS |
| `node scripts/nodeless-moji-boot.cjs` | PASS |
| `npm test` | PASS |
| `node scripts/preview-readiness.cjs` | NOT_READY (34 checks; expected exit 2) |
| `node scripts/verify-state.cjs` | NOT_READY |
| ASAN / ownership review / external audit | NOT RUN |

## Limits

- the Promise is backed by a blocking private host call; main timers and jobs
  do not run while the panel is open, concurrent dialogs are serialized, and
  the native host control lane is occupied until the panel closes;
- the panel is app-modal; a parent overload is accepted but not sheet-attached;
- the test-injected selection is contract evidence, not human-consent evidence;
  real human selection and write consent are **NOT RUN**; the UI smoke uses a
  window, so the no-window parentless panel path is implemented but not
  independently exercised;
- `filters` restrict the native panel but Electron filter names are not shown;
- a dead client can leave the host in `runModal` until the panel closes or the
  one-hour bound expires;
- selected files/directories receive read access only; save dialogs,
  readwrite consent, grant persistence, revocation and policy migration are
  not implemented;
- canonicalization is checked when the selection is granted, so a
  trusted-main TOCTOU window remains between the grant and later `fs` use;
- the original preload/contextBridge, renderer file/dialog production consent,
  print-accurate export, updater/zlib behavior and strict profile remain open.

This is a main-dialog read-consent increment for the Node-less adapted profile,
not an Electron-compatible runtime release.
