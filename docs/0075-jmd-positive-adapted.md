# jmd positive on the adapted Linux profile

Status: **adapted-profile PASS on Linux; `compatible:false`.** Pinned jmd 0.2.3
(`f875fc6`) boots its real Vite renderer in GTK/WebKitGTK, opens a markdown
document through a test-injected native open dialog, renders the marker in the
preview, and loads a relative PNG through the `jmd-file` broker. It then edits
the real CodeMirror editor (both a fixed host hook and real X11/xdotool ASCII
key events), saves through the app's `menu:save` action and a real Ctrl+S
chord, verifies the exact file bytes, and reloads after an external rewrite
via the bounded polling `fs.watch` facade. `fs.watchFile`/`fs.unwatchFile` and
bounded recursive `fs.watch` are implemented and covered by the fixture.
Multi-display selection is exercised against the single Xvfb monitor. The
original preload is not executed. IME, native menu installation, `net` and
macOS remain **NOT RUN/out of scope**.

This is not an Electron-compatibility result and does not unblock the strict
`electron-nodeless-v1` profile.

## What runs

- Pinned upstream source `f875fc616feb89ea803a0fc140ec770a2ade041e`.
- `npm ci --ignore-scripts` + `npm run build` produce jmd's `dist/` Vite
  renderer. The source checkout stays unchanged.
- A staged copy is adapted (see below) and booted through
  `emoon run --window`. The renderer is served as
  `electron-mbt-app://app/dist/index.html`.
- A CLI-only test hook dispatches `test:open-dialog` in main. That calls jmd's
  real `openFileDialog()`; the Linux host opens the real GTK dialog and the
  test harness auto-selects `_build/jmd-positive-doc/note.md`.
- `openPath()` reads the file through the main `fs` facade and sends
  `file:opened`; the renderer opens a tab, sets the window title to
  `note.md — jmd`, and renders the preview.
- A fixed test hook appends `jmd-edit-marker-20261029` through the focused
  `.cm-content` and CodeMirror's DOM path, then `test:menu-save` sends the same
  `menu:save` topic the native Save item would send. The app's own `save()`
  writes the file; the test checks the bytes, the preview and the dirty title.
- A real X11 path focuses `.cm-content` through a fixed host helper, then
  `xdotool` types `jmd-key-marker-20261029` and sends Ctrl+S. The adapted page
  binds Ctrl+S to jmd's own `save()` because the native menu is store-only;
  this is a page adaptation, not native menu installation. The test disables
  the desktop IME (`GTK_IM_MODULE=gtk-im-context-simple`) so only ASCII is
  typed; IME is NOT RUN. A direct window-event retry runs only if the file
  still lacks the keyboard marker at 12.5 s; an external rewrite follows at
  20 s.
- A second process appends `jmd-watch-marker-20261029` while the app is open.
  The prelude's bounded `fs.watch` stat poller emits a change; jmd's
  `file:changed` path reloads the tab and the preview updates.
- The document includes `![pixel](pixel.png)`. The bespoke page shim's
  `resolveAsset` produces `jmd-file://local/<encoded path>`; the stage admits
  `jmd-file` and the asset broker serves the dialog-granted document-directory
  image. The probe sees `naturalWidth:16`.

## Staged adaptations

All edits are on `_build/jmd-positive-stage`; the pinned checkout is untouched.
`compatibility/reports/jmd-positive-adaptation.json` records the source and
adapted SHA-256s and each before/after snippet.

| Edit | Why |
| --- | --- |
| Remove the `JMD_SMOKE` block | It contains a computed `require`; the static CJS graph builder rejects it with `ELECTRON_MBT_DYNAMIC_REQUIRE` before protocol registration. |
| Remove `bypassCSP: true` from the `jmd-file` scheme | The adapted admission rejects `bypassCSP` with `ELECTRON_MBT_UNSUPPORTED_PROTOCOL_PRIVILEGE`. The scheme remains `standard`, `secure`, `supportFetchAPI`. |
| Add `ipcMain.handle('test:open-dialog')` | CLI-only test hook to drive the real open dialog; the renderer never calls it. |
| Bespoke `window.jmd` page shim | Linux has no original-preload execution. It implements the preload's IPC calls, pure `basename`/`resolveAsset`, the event listeners, and a Ctrl+S binding to jmd's own `save()`. IPC dispatch stays runtime/MoonBit-owned. The native menu remains store-only. |
| Host `focus-jmd-editor` | Fixed test-only helper that focuses `.cm-content` and places the caret at the end before X11 typing. It does not expose generic script execution. |
| `nativeTheme` facade | jmd reads `shouldUseDarkColors` at window creation. The facade returns `false` and exposes inert listener methods. |

The original `electron/preload.js` is copied for provenance but is
**NOT_EXECUTED**; `webUtils.getPathForFile` is fail-closed in the page shim.

## Evidence

- `node scripts/jmd-positive.cjs`: **PASS**.
  - `compatibility/reports/jmd-positive.json`:
    `adaptedBoot:true`, `windowTitle:"note.md — jmd"`,
    `openDialog:true`, `previewMarker:true`, `assetServed:true`,
    `imageLoaded:true`, `handlerExecuted:false`, `editSaved:true`,
    `keyboardSaved:true`, `editCleanTitle:true`, `watcherReloaded:true`,
    `saveDispatched:true`, `displayBounds:true`, `displayCount:true`,
    `matchingBounds:true`, `messageBox:true`.
  - Assets: `schemes:["jmd-file"]`, `requests:1`, `served:1`,
    `bytes:116`, `denied:0`, `handlerExecuted:false`.
  - Preview text:
    ```
    jmd positive

    jmd-positive-marker-20261029

    A pinned jmd renderer opened this document through the adapted open dialog.

    jmd-edit-marker-20261029jmd-key-marker-20261029
    jmd-watch-marker-20261029
    ```
- The same stage in a manual run:

  ![jmd 0.2.3 adapted positive](images/jmd-positive-20261029.png)

- CI: `.github/workflows/ci.yml` checks out the pinned jmd source, runs
  `npm ci --ignore-scripts` + `npm run build`, and runs the smoke under Xvfb.
  `CI=true` makes a missing source/build a hard failure instead of a skip.
  GitHub Actions run 298 (`0d3b1ac`, `linux-native`) completed successfully,
  including the real X11/xdotool keyboard step and the expanded facade checks.
  The CI apt step installs `xdotool`.

## Reproduction

```
node scripts/jmd-positive.cjs
```

The script requires:
- `_build/jmd-positive-src` (or `JMD_SOURCE`) at the pinned revision with
  `dist/index.html` built;
- a built `dist/emoon` or `_build/native/debug/.../emoon`;
- `dist/emoon-host` for the Linux display;
- `xdotool` on `PATH` for the real X11 keyboard step.

It builds the stage with `scripts/jmd-adapt.cjs`, drives the open dialog, and
writes `compatibility/reports/jmd-positive.json`.

## Limits

- The open dialog, message box response and the fixed editor-edit hook are
  test-injected. Keyboard input is real X11/xdotool ASCII; a human picker,
  IME and non-ASCII human typing acceptance are NOT RUN. The desktop IME is
  disabled for the test.
- Save goes through the app's `menu:save` renderer action for the synthetic
  edit, and through a real Ctrl+S chord for the X11 edit. The native menu is
  **store-only**; Ctrl+S is bound in the adapted page. Native menu installation
  is not claimed.
- `fs.watch`, `fs.watchFile` and recursive `fs.watch` are bounded polling
  facades, not inotify. They deliver the jmd reload path and fixture events but
  not native event fidelity; recursive/`watchFile` caps are 4096 entries and
  250..60000 ms intervals. `persistent`/`unref()` are accepted but do not claim
  a process-lifecycle behavior.
- `loadFile` query supports string/number/boolean values only; the app scheme
  now accepts a query on the entry document. `loadURL` query and unusual value
  types are not covered.
- `dialog.showMessageBox` only works with the test env; without it the API is
  typed unsupported. `showMessageBoxSync` follows the same injection.
- `screen.getAllDisplays` uses GDK monitors; `getDisplayNearestPoint` and
  `getDisplayMatching` select by containment/intersection. The fixture has one
  Xvfb monitor; hardware multi-monitor selection is NOT RUN. A 1280x800
  fallback remains if the host op is unavailable.
- `net` remains unsupported/out of scope; native menu installation is not
  claimed; `droppedFilePath` stays fail-closed.
- jmd's `protocol.handle` is recorded, not executed; the broker owns the
  response. This is an adapted-profile substitution.
- macOS is out of scope.
- `compatible:false`; strict profile remains blocked; original preload
  NOT_EXECUTED.
