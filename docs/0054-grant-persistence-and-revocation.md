# Grant persistence and revocation

Status: **Phase 3 increment implemented; human consent and a Moji normal-save
scenario are not claimed.** `compatible:false`, M0 OPEN, the original preload
NOT_EXECUTED and the strict profile blocked are unchanged.

## Problem

Main-side file and directory grants were session-scoped and never persisted.
A user who opened a file through the native panel had to grant it again after
every restart, and there was no way to revoke a grant. The store also needed to
fail closed for symlink substitution, malformed JSON and a stale generation of
the store format.

## Change

1. The native host now owns a grant store at
   `<app>/.userData/electron-mbt/grants-v1.json`.
   - schema 1 with `files` and `directories` arrays;
   - 256 KiB read bound, 64 file / 16 directory caps;
   - 0700 directory and 0600 file;
   - atomic write via `NSDataWritingAtomic`;
   - stored paths must equal their canonical `realpath`, so a symlink
     substitution is rejected;
   - a missing grant target is skipped (less privilege); any malformed entry,
     non-regular file, non-directory path or schema mismatch rejects the whole
     store and grants nothing.
2. Grants are saved after `grant-main-file`, `grant-main-directory`, the
   native open/save selection path, and revocation. The store is loaded at
   host startup before windows are created.
3. New CLI-only controls:
   - `get-main-grant-store` returns the path, load/persist status, error code
     and the bounded file/directory entries;
   - `revoke-main-grant` removes one canonical file or directory grant and
     rewrites the store.
   These controls are not in the QuickJS app allowlist.
4. New selftests:
   - `--grant-persist-selftest` loads an existing store without granting
     anything, verifies the scenario read/write paths are present, then runs
     the app's `userfile:selftest`;
   - `--grant-revoke-selftest` revokes both scenario paths, verifies the store
     is empty, and verifies `main-read-file` / `main-write-file` are denied.
   The report includes `grantStore`, `grantPersistSelftest` and
   `grantRevokeSelftest`. `grant-persistence` is removed from `notVerified` only
   when the persistence/revocation selftest passes.

## Evidence

| Command | Result |
| --- | --- |
| `node --test tests/nodeless-runtime.test.cjs` | **33 PASS** |
| `npm test` | **489 pass / 0 fail** |
| `moon test --target js` | **145 pass** |
| `moon test --target native` | **178 pass** |

Executed sequence in the new test:

1. `--user-file-selftest`: grants read + readwrite and writes the store
   (mode 0600) with two entries.
2. `--grant-persist-selftest`: loads the store, sees both grants, and the app
   reads/writes without re-granting.
3. `--grant-revoke-selftest`: revokes both, store becomes empty, and both
   `main-read-file` and `main-write-file` are denied.
4. `--grant-persist-selftest` again: fails closed because the grants are gone.

A second test corrupts the store with invalid JSON and with a symlink path;
both runs fail closed with `ELECTRON_MBT_GRANT_STORE_INVALID` and the app
selftest fails.

A third test uses one document as both `readPath` and `writePath`: the first
process grants readwrite and saves the document; after resetting the file, a
new process loads the persisted grant and saves the same path in place. This is
the deterministic normal-save/restart fixture, not a Moji UI scenario.

## Limits

- The store lives under the app's `.userData`, which the trusted main can write.
  The threat model trusts the installed main; this is not a sandbox against a
  malicious main. Renderer access is unaffected because the renderer has its
  own per-window broker grants.
- Revocation is a CLI-only control. There is no user-facing “manage grants” UI
  yet.
- Human open/save panel selection, overwrite confirmation and the Moji
  edit/save/restart UI scenario remain NOT RUN. The deterministic fixture
  normal-save/restart path passes.
- The store is not encrypted or signed. File permissions and the trusted-main
  boundary are the current protection.
- Single Node-less window remains.
- No strict-profile admission, `compatible:true` or A–J row promotion.

## Next

1. Run the deterministic normal-save/restart path against Moji and record the
   app revision, adapted API, and byte comparison.
2. Record human panel selection and overwrite confirmation as a separate manual
   gate.
3. Move to the remaining Phase 3 items: sheet-modal parenting, grant revoke UX,
   and the Moji edit/save/restart scenario.
