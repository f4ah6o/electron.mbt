# Moji open-for-edit: edit, normal save, restart and re-open

Status: **Phase 3 increment implemented; human input and production consent are
not claimed.** `compatible:false`, M0 OPEN, the original preload
NOT_EXECUTED and the strict profile blocked are unchanged.

## Problem

The adapted page API could open a test dialog and save a path that had a
test-injected `grant-file` write bit, but the product path did not work:
opening a file granted only `read`, so Moji's normal `Save` (which calls
`window.api.save(doc.path, text)` without a save dialog) was denied. There was
also no scenario that drove the real renderer's own controls through an edit,
a normal save, a process restart and a re-open.

## Change

### Open-for-edit grant

`openDialogWithReply` now treats a renderer open as **open-for-edit**, matching
the policy in [0011](../issues/polished/0011-app-loading-origin-and-storage.md):

1. canonicalize and validate one regular file;
2. read it with the existing 1 MiB bound and UTF-8 check **before** granting;
3. apply a session broker grant of `readwrite` for that exact path;
4. apply the narrower main grant (`read`);
5. if the main grant fails, restore the broker's previous bits and deny.

The grant is exact-file, not a directory grant. A sibling save after the open
is still denied. Renderer file grants are **app-session** grants, matching the
0011 lifetime row: the existing supervisor reload fixture relies on a grant
surviving a reload, so `begin-load` does not clear them. Revocation is app
stop, window destruction or an explicit control; a document-scoped grant
lifetime is a separate design question. Main grant persistence is unchanged:
the store records the main `read` selection, not a renderer write grant. The
policy is recorded in `fixtures/moji-adapted/api.json` and
`compatibility/apps/moji-v1.0.5/adapted-preload.json`; the runtime does not
parse that field yet, the profile behavior is fixed in the host.

### atomic-replace-v1

`file:save` and the save-as document paths no longer call
`writeToFile:atomically:YES` directly. `writeAtomicReplace`:

1. `lstat`s the target and rejects a symlink, a non-regular file or a file with
   `st_nlink != 1` (`ELECTRON_MBT_FILE_SYMLINK` / `ELECTRON_MBT_FILE_LINK`);
2. opens the existing target with `O_NOFOLLOW`, rechecks `st_dev`/`st_ino`, and
   creates a `mkstemp` file in the same directory;
3. copies mode/owner/ACL/xattrs with `fcopyfile(COPYFILE_METADATA)` and verifies
   the mode/owner before writing;
4. writes all bytes, `fsync`s the temporary file, and checks the target
   identity again (`ELECTRON_MBT_FILE_CONFLICT` on a changed inode);
5. `rename`s over the target, then `fsync`s the parent directory. A failed
   parent fsync reports `durability:"unknown"`; a failure before the rename
   unlinks the temporary file and leaves the original bytes intact.

A new target is created with mode `0644`. The check-then-rename window remains,
so this is not a hostile-writer CAS. The positive fixture sets mode `0640` and
`user.electron-mbt=metadata-preserved`, saves twice, and verifies both survive.
A hardlinked document is denied with `ELECTRON_MBT_FILE_LINK`, and both links
keep the same 103 bytes.

### Test-only UI driver

A new CLI-only native control `trigger-renderer-edit-save` evaluates a fixed
page-world script that uses the pinned Moji UI:

- clicks the toolbar Open button;
- waits for the `note.md` document tab / title;
- clicks the Editor segment button;
- focuses `.cm-content`, places the caret at the end of the last text line and
  inserts a marker with `document.execCommand('insertText')`;
- waits for the dirty title marker (`•`);
- clicks the toolbar Save button and waits for the clean title.

If `insertText` does not produce the marker, the script falls back to the
app's own replace panel (`ORIGINAL_TOKEN` → `ORIGINAL_TOKEN + marker`) and
records `editMechanism:"replace"`. The scenario never calls
`window.api.save` as a substitute for the Save button.

The script also probes grant scope directly:

- before Open, `window.api.save('documents/note.md', ...)` must be denied;
- after Open, `window.api.save('documents/sibling.md', ...)` must be denied.

The operation requires `ELECTRON_MBT_TEST_MODE=1`, a loaded document and the
adapted adapter. It is in the CLI control allowlist but **not** in the
QuickJS app allowlist.

`get-ingress-status` now reports `fileSaveAdmitted` / `fileSaveDenied`.
`file:save` increments them and `begin-load` resets them, so the evidence shows
that the UI's Save reached the native `file:save` handler exactly once.

### CLI and harness

`native/nodeless/main.mbt` adds:

- `--moji-edit-save-selftest` (Phase 1: open → edit → save);
- `--moji-reopen-selftest` (Phase 2: restart → open → verify first marker →
  edit → save);
- `--moji-save-failure-selftest` (Phase 3: open a hardlinked document and call
  `window.api.save` directly; the broker must reject it).

All require `--window`, are mutually exclusive, and require a broker scenario
with **zero grants and one open dialog**. The CLI polls `probe-renderer` for
`window.__mojiEditSaveProbe` and reports `mojiScenario`, `mojiEditSave`,
`mojiReopen` and `mojiSaveFailure`.

`scripts/nodeless-moji-edit-save.cjs` builds a disposable app from the pinned
Moji output, creates `documents/note.md` **outside** the source manifest (a save
must not invalidate the restart manifest), runs the two processes with a fake
`node` on `PATH`, and compares exact UTF-8 bytes. The document is:

```
# ノート

元の内容 🚀

ORIGINAL_TOKEN
```

The harness report is
[compatibility/reports/moji-nodeless-edit-save.json](../compatibility/reports/moji-nodeless-edit-save.json).

## Evidence

| Command | Result |
| --- | --- |
| `node --test tests/nodeless-runtime.test.cjs` | **34 PASS** |
| `npm test` | **492 pass / 0 fail** |
| `moon test --target js` | **145 pass** |
| `moon test --target native` | **178 pass** |
| `node scripts/preview-readiness.cjs` | **NOT_READY** (35 checks: 28 PASS / 2 FAIL / 5 NOT RUN) |
| `node scripts/verify-state.cjs` | **19/19 PASS, NOT_READY** |

Observed scenario:

| Field | Phase 1 | Phase 2 | Phase 3 |
| --- | --- | --- | --- |
| open dialog | test-injected, 1 | test-injected, 1 | test-injected, 1 |
| broker grants | 0 | 0 | 0 |
| document title | `note.md - Moji v1.0.5` | `note.md - Moji v1.0.5` | `note.md - Moji v1.0.5` |
| edit mechanism | `execCommand-insertText` | `execCommand-insertText` | direct save probe |
| save before open | `ELECTRON_MBT_FILE_DENIED` | not probed | not probed |
| sibling save | `ELECTRON_MBT_FILE_DENIED` | not probed | not probed |
| `fileSaveAdmitted` | 1 | 1 | 0 |
| `fileSaveDenied` | 2 | 0 | 1 |
| reopen marker | n/a | present | n/a |
| document bytes | 47 → 74 | 74 → 103 | 103 unchanged |
| save result | ok | ok | `ELECTRON_MBT_FILE_LINK` |
| mode / xattr | 0640 / preserved | 0640 / preserved | 0640 / preserved |
| final SHA-256 | `a0cfa58c…a27e2` | `aa48440f…a6ba` | `aa48440f…a6ba` |

The first save inserts the marker at the end of the last text line; the
contenteditable caret is before the trailing newline, so the inserted marker's
leading newline replaces that final line break. The harness compares the exact
resulting bytes, not a substring.

## Limits

- The open dialog is test-injected. No human `NSOpenPanel` selection,
  overwrite confirmation or sheet-modal parenting was run.
- The edit is synthetic DOM input (`execCommand`) or the app's replace panel,
  not human keyboard input, IME or accessibility interaction. The replace-panel
  fallback is implemented but was not exercised in this run; both recorded
  phases used `execCommand-insertText`.
- The save now uses `atomic-replace-v1`: mode `0640` and the
  `user.electron-mbt` xattr survive both saves, and a hardlinked document is
  rejected with `ELECTRON_MBT_FILE_LINK` while both links keep the same bytes.
  Owner/ACL are copied by `fcopyfile` but are not separately asserted; the
  check-then-rename conflict window remains. Fault injection for
  `fsync`/`rename`/reply loss and a hostile-writer CAS are NOT RUN.
- The restart deliberately re-opens through the picker. It does not restore a
  write grant from the previous session; that is the policy in 0011. The main
  grant store keeps only the main `read` selection. Renderer grants are
  app-session and survive a reload; a document-scoped lifetime is not
  implemented.
- Single Node-less window; child frames, original preload, contextBridge,
  strict profile and an Electron differential remain NOT RUN.
- No `compatible:true`, no A–J row promotion and no M3 checkbox completion.

## Next

1. Run the human open/save panel gate separately, including selection,
   overwrite confirmation and sheet parenting.
2. Add a real IME/AX/keyboard edit scenario; the current edit is synthetic.
3. Add fault-injection evidence for `fsync`/`rename`/reply loss and a
   hostile-writer conflict test; test the app-session grant revocation/lifetime
   explicitly, since the current grant survives a reload and is not
   document-scoped.
4. Continue Phase 3 with the human dialog gate and grant-management UI.
