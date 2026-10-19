# Node-less main directory and metadata fs

Status: **partial directory/metadata increment**. The trusted QuickJS main can
inspect app-local paths and create bounded directories under the runtime data
roots through the native host. This extends the existing exact-file main `fs`
surface ([docs/0046](0046-nodeless-main-fs.md)); it is not Node's full
`fs.Stats`/`fs.Dirent`, has no directory grants in this increment (added in
[docs/0049](0049-nodeless-directory-grants.md)), streams, `lstat`, `rm`/`unlink`
or true thread-pool I/O, and keeps `compatible:false`, adapted **partial**,
strict **blocked** and the original preload **NOT_EXECUTED**.

## What works

`--window` installs the private host bridge before main evaluation. The prelude
then exposes:

| API | Behavior |
| --- | --- |
| `fs.statSync(path[, options])` | Returns a partial Stats object `{ size, mtimeMs, isFile(), isDirectory() }`. Follows symlinks. `throwIfNoEntry:false` returns `undefined` for a missing path; `bigint:true` is unsupported. |
| `fs.readdirSync(path[, options])` | Returns filename strings, or partial Dirent objects with `withFileTypes:true`. Only `utf8`/`utf-8` encoding is accepted; `recursive:true` and other encodings are unsupported. |
| `fs.mkdirSync(path[, options])` | Creates one directory, or a missing chain with `recursive:true`. `mode` and `signal` are unsupported. Returns `undefined`; with `recursive:true` and new components, returns the **absolute canonical path of the first created directory**. |
| `fs.promises.stat` / `readdir` / `mkdir` | Promise wrappers over the same bounded synchronous host calls. They settle on a microtask; this is not Node thread-pool I/O. |

`Dirent` is partial: `{ name, parentPath, isFile(), isDirectory(),
isSymbolicLink() }`; `parentPath` is the canonical host path. `statSync` follows
symlinks, so its Stats object intentionally has no `isSymbolicLink()`.
Unsupported Node fields are absent rather than fabricated.

## Policy and bounds

| Item | Value |
| --- | --- |
| stat roots | canonical app root, or an exact session user-file grant |
| readdir roots | canonical app root only; an exact file grant does **not** grant its parent directory |
| mkdir roots | `.appData` and `.userData` roots and descendants only; exact file grants do **not** grant directory creation |
| directory entries per call | 4,096 |
| name bytes per call | 524,288 (512 KiB) |
| new mkdir components | 64 per call |
| path limit | 4,096 UTF-16 code units, no NUL; host canonicalization additionally uses macOS `PATH_MAX` |
| created directory mode | `0700` for each component created by the runtime |
| symlinks | canonicalized before access; escaping/dangling targets are denied; readdir classifies entries with `lstat` and never follows them |
| ordering | `readdir` order is host/filesystem order; no sorting guarantee |
| lifetime | state is the host session; no persistence. Directory grants are a separate model ([docs/0049](0049-nodeless-directory-grants.md)) |

`mkdirSync` creates recursive components one at a time so each new directory
gets `0700`. It is not atomic: a later failure can leave earlier components in
place. Explicit `mode` is rejected instead of silently applying `0700`.

## Privilege separation

The QuickJS app main is trusted app code, but it may request bounded file
operations, not mint authority. The host validates canonical roots, entry
counts, name bytes, mkdir depth and types. App code can call `main-stat`,
`main-read-dir` and `main-mkdir` only through the host bridge allowlist; it still
cannot call `grant-main-file`, `grant-file`, `set-dialog-result`, renderer
probes, ingress release, `app-reply` or `shutdown`. The page realm cannot reach
the private host channel.

User-file selections remain exact-file grants: a granted file can be stat'ed,
read or written, but `readdirSync` of its parent and `mkdirSync` next to it stay
`EACCES`. Directory grants are **NOT IMPLEMENTED**.

## Error mapping

| host code | JS code |
| --- | --- |
| `ELECTRON_MBT_FILE_DENIED` | `EACCES` |
| `ELECTRON_MBT_FILE_NOT_FOUND` | `ENOENT` |
| `ELECTRON_MBT_FILE_NOT_DIR` | `ENOTDIR` |
| `ELECTRON_MBT_FILE_EXISTS` | `EEXIST` |
| `ELECTRON_MBT_FILE_TYPE` | `EISDIR` |
| `ELECTRON_MBT_FILE_LIMIT` | `EFBIG` |
| `ELECTRON_MBT_FILE_WRITE` / `_READ` | `EIO` |
| malformed envelope / invalid argument | `EINVAL` |
| missing host bridge | `ELECTRON_MBT_HOST_UNAVAILABLE` |
| non-allowlisted QuickJS host operation | `ELECTRON_MBT_HOST_REQUEST_DENIED` |

A path outside the allowed roots reports `EACCES` for
`statSync`/`readdirSync`/`mkdirSync` and `false` for `existsSync`; it does not
disclose whether the path exists. `statSync` on a dangling symlink is denied by
canonicalization (`EACCES`), not treated as an ordinary missing path.

## Deterministic fixture

`fixtures/nodeless-fs-app` extends `fs:selftest` with:

- recursive mkdir, first-created suffix, idempotent recursive mkdir,
  non-recursive `EEXIST`, file-target `EEXIST`, missing-parent `ENOENT`;
- directory listings, `withFileTypes` file/directory predicates, a pre-created
  `sample-link` symlink Dirent, UTF-8 names;
- `statSync` file size/mtime, directory, missing/outside errors,
  `throwIfNoEntry:false`, unsupported `bigint`;
- `readdirSync` missing/file/outside and unsupported encoding/recursive;
- denied app-root mkdir, traversal, and unsupported `mode`;
- Promise `stat`/`readdir`/`mkdir`, including creating the `.userData` root;
- escape list/stat codes that are `ENOENT` normally and `EACCES` when the test
  pre-creates an escaping symlink.

A generated-app test additionally pre-creates `.appData/escape` as a symlink to
an outside directory, asserts list/stat/recursive-mkdir all return `EACCES` and
no outside directory is created, then exercises the 4,097-entry and 65-component
bounds as `EFBIG`.

## Verification

Environment: macOS 26.5.2 arm64, Node 24.22.0, pinned QuickJS 2026-06-04, built
`dist/electron-mbt-native-host`.

| command | result |
| --- | --- |
| `moon build --target native native/nodeless` | PASS |
| `node scripts/build-macos-host.cjs` | PASS |
| `node --test tests/nodeless-runtime.test.cjs` | 17 PASS |
| `node scripts/nodeless-moji-app.cjs` | PASS |
| `node scripts/nodeless-moji-boot.cjs` | PASS |
| `moon test --target native` | 177 PASS |
| `moon test --target js` | 145 PASS |
| `npm test` | 472 PASS |
| `node scripts/preview-readiness.cjs` | NOT_READY (33 checks; expected exit 2) |
| `node scripts/verify-state.cjs` | NOT_READY (18/18 checks PASS) |
| ASAN / ownership review / external audit | NOT RUN |

## Limits

- partial `Stats`/`Dirent` objects; full Node fields and methods are absent;
- no `lstat`, `realpath`, `readdir` recursive, `rm`/`unlink`, streams,
  descriptors, append flags or callback-style directory APIs;
- `readdir` order is unspecified, and the entry/name/depth bounds are lower
  than Node's unbounded behavior;
- `mkdirSync` applies `0700`, rejects explicit `mode`, is not atomic, and its
  recursive first-created return value is absolute rather than the caller's
  relative spelling;
- directory grants were added later
  ([docs/0049](0049-nodeless-directory-grants.md)); this increment's user
  selections remain exact-file only;
- canonicalization is checked before the operation, so a trusted-main TOCTOU
  window remains;
- non-window `run` has no host bridge, so the new APIs fail with
  `ELECTRON_MBT_HOST_UNAVAILABLE`;
- `zlib`, updater behavior, grant persistence, human panel consent, the original
  preload/contextBridge and the strict profile remain open.

This is a directory/metadata fs increment, not an Electron-compatible runtime
release.
