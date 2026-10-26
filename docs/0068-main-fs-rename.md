# Main fs rename/unlink

Status: generic main-process filesystem surface, Linux-verified; `compatible:false`.

Electron apps commonly persist settings and drafts by writing a sibling temp
file and renaming it over the destination, then unlinking the temp file on
failure. Moji 1.0.7 does this for recovery drafts; without rename/unlink its
initial UI showed `Could not restore recovery drafts: ELECTRON_MBT_MAIN_ERROR`.

## Surface

- `fs.renameSync(source, destination)` and `fs.promises.rename(...)`.
- `fs.unlinkSync(path)` and `fs.promises.unlink(...)`.
- Host operations: `main-rename` (`path`, `destination`) and `main-unlink`
  (`path`).

Both operations use the same policy as `main-write-file`:

- app-local `.appData` / `.userData` are writable;
- a session-granted exact file with write rights is writable;
- canonical source/destination paths only; a symlink is resolved before policy,
  and app-source paths are denied;
- directories are rejected; rename/unlink errors map to the existing
  `ELECTRON_MBT_FILE_*` codes (`EACCES`/`EPERM` → `FILE_DENIED`,
  `ENOENT` → `FILE_NOT_FOUND`, `EISDIR`/`ENOTDIR` → `FILE_TYPE`,
  `EROFS` → `FILE_READ_ONLY`, disk limits → `FILE_LIMIT`, else `FILE_WRITE`).
- No chmod/chown/truncate/link/statfs/utility-process surface is added.

## Evidence

- Moji 1.0.7 adapted initial UI: the draft-recovery error toast is gone; page
  still reports `rendererLoaded:true`, `apiPresent:true`, 4 requests / 0 reply
  errors.
- `moon test --target native`: 198 PASS; JS: 163 PASS.
- `npm test`: 534 tests / 501 PASS / 0 FAIL / 33 SKIP.

File open/save workflows and drag/export remain NOT verified. This is not a
compatibility claim.
