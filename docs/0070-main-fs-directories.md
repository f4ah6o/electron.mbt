# Main fs directories and app data paths

Status: generic main-process fs support, Linux-verified; `compatible:false`.

Moji 1.0.7 writes settings with:

```js
fs.writeFileSync(`${userData}/settings.json.tmp`, json);
fs.renameSync(`${userData}/settings.json.tmp`, `${userData}/settings.json`);
```

`app.getPath('userData')` returned `.appData/<name>`, but only `.appData` /
`.userData` existed. The parent directory was missing, so `main-write-file`
failed with `DENIED`, the app silently removed the temp file, and settings /
recent files were never persisted. Draft loading also needed directory listing.

## Surface

- `main-mkdir` (`path`, `recursive`): creates a directory under `.appData`,
  `.userData`, or a write-granted path; recursive creation is supported for
  missing parents inside those roots; returns `{path, firstCreated}`.
- `main-read-dir` (`path`): lists a readable directory (app root or an exact
  read/write grant) as `{path, entries:[{name,kind}]}`, where kind is `file`,
  `directory`, `symlink` or `other`; entries are capped at 4096 and names at
  255 bytes.
- `app.getPath('userData' | 'appData' | 'sessionData')` now ensures the
  directory exists through `main-mkdir(recursive:true)` before returning it,
  matching Electron's creation of app data directories.
- Path allocation was made consistent (malloc/`free` for path strings, `g_free`
  for GLib-only temporary strings) after new-file writes exposed invalid frees.

Both operations are on the app-code host-operation allowlist and route through
the same window/generation/error path as the other main fs operations. No
recursive directory removal, chmod/chown, or host-control operation is exposed.

## Evidence

- Moji 1.0.7 open flow via Ctrl+O, auto-selected test dialog:
  `main-open-dialog` → `file:open-many-start` → `main-stat` →
  `send-adapted-event` progress/done → `emoon:read-file` → preview renders
  `Emoon open test` / `UNIQUE_OPEN_MARKER_12345`.
- Editing and Ctrl+S wrote the edited bytes to the sample file:
  `# Save test ... EDITED_BY_EMOON`; host log showed `main-write-file` and
  `main-rename`.
- `.appData/<app>/settings.json` now exists with `recentFiles` and
  `lastDialogDirectory`; the next launch welcome screen shows the recent file.
- Initial UI no longer shows the recovery-draft error toast; host did not crash
  during `main-read-dir`.
- `moon test --target native`: 199 PASS; JS: 163 PASS; `npm test`: 534 / 501
  PASS / 0 FAIL / 33 SKIP.

Draft autosave, export/PDF, drag-and-drop and the settings panel remain NOT
verified. macOS native remains NOT RUN; no compatibility claim.

## Draft autosave and settings UI (round 4)

- Typing into a new document produced `drafts:save` → `main-write-file` →
  `main-rename`; the shared app data directory now contains
  `.appData/<app>/drafts/manifest.json` and a draft `.md` file. The next launch
  restores the Untitled document (seen in the Settings screenshot).
- The Settings panel opens and shows General/Preview/Editor/Shortcuts tabs;
  settings and the recent-file welcome screen use the persisted
  `settings.json`.
- The Export dialog opens and offers PDF/HTML/PNG, page size and orientation.
  PDF, HTML and PNG now export through the offscreen path described in
  [docs/0071](0071-pdf-html-export.md); PDF and PNG are raster.
