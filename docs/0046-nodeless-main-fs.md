# Node-less main-side fs

Status: **partial main-runtime increment**. The trusted QuickJS main now reads
app-local files and atomically writes the runtime data roots through the native
host, and can read/write exact user files granted by a native panel or the
explicit test scenario. This closes the import-only `fs`/`fs.promises` stubs,
but it is not Node's file system: grant persistence, production directory
consent, stream APIs, metadata preservation and true thread-pool I/O remain open. `compatible:false`,
adapted **partial**, strict **blocked** and original preload **NOT_EXECUTED**
are unchanged.

## What works

`--window` installs the private host bridge before main evaluation. The prelude
then exposes:

| API | Behavior |
| --- | --- |
| `fs.existsSync(path)` | `true` for an existing path under the app root; `false` for missing, denied or host-unavailable. |
| `fs.readFileSync(path, options?)` | Buffer by default; `utf8`/`utf-8`, `ascii` or `base64` string with an encoding. |
| `fs.writeFileSync(path, data, options?)` | String/`Uint8Array`/`Buffer` input; atomic replace under `.appData` or `.userData`. |
| `fs.promises.readFile(path, options?)` | Promise wrapper over the same bounded read. |
| `fs.promises.writeFile(path, data, options?)` | Promise wrapper over the same bounded write. |

`fs.promises` is also available on the `fs` module. The async methods run the
same synchronous, bounded host call and settle on a microtask; they do not use a
Node thread pool. Directory listing, partial `Stats` and bounded `mkdirSync` are
documented separately in [docs/0048](0048-nodeless-directory-fs.md).

## Policy and bounds

| Item | Value |
| --- | --- |
| read root | canonical app root, including `.appData` and `.userData` |
| write roots | `<app-root>/.appData/` and `<app-root>/.userData/` only |
| read limit | 262,144 bytes |
| write limit | 262,144 bytes |
| path limit | 4,096 UTF-16 code units, no NUL |
| base64 ceiling | 400,000 characters |
| write mode | Cocoa atomic replace (`atomic-replace-v1`) |

Relative paths resolve from the app root. Existing paths and the nearest
existing ancestor are resolved with `realpath`; `..` and symlinks that escape an
allowed root are denied. Missing parent directories under an allowed write root
are created with `0700`, which lets the pinned Moji
`appData/moji/settings.json` write succeed. This directory creation is an
explicit adaptation and is not Node's `writeFile` behavior.

The main process is trusted app code. The renderer cannot call these host
operations directly, and the page file broker keeps its own per-window grants.
Main reads of user-selected files outside the app root are supported after an
explicit native panel/test grant; grants are session-scoped and exact-file only
([docs/0047](0047-nodeless-user-file-grants.md)). Grant persistence and
production directory consent remain open. Directory grants are a separate
session model ([docs/0049](0049-nodeless-directory-grants.md)); this file's
exact-file grants do not make a parent directory usable. The bounded
directory/metadata surface in [docs/0048](0048-nodeless-directory-fs.md) exists.

## User-file grants

A completed native open panel grants main read access to the selected canonical
file; save/export panels grant readwrite. `nodeless-user-file.json` with
`--user-file-selftest` grants the two listed absolute paths for the deterministic
fixture. `grant-main-file` is a private control operation; the QuickJS bridge
allowlist rejects it, so app code cannot self-grant. Ungranted outside-root paths
remain `EACCES`/`false`. See
[docs/0047](0047-nodeless-user-file-grants.md) for the policy, bounds and
privilege separation.

## Error mapping

| host code | JS code |
| --- | --- |
| `ELECTRON_MBT_FILE_DENIED` | `EACCES` |
| `ELECTRON_MBT_FILE_NOT_FOUND` | `ENOENT` |
| `ELECTRON_MBT_FILE_TYPE` | `EISDIR` |
| `ELECTRON_MBT_FILE_LIMIT` | `EFBIG` |
| `ELECTRON_MBT_FILE_WRITE` / `_READ` | `EIO` |
| malformed envelope / invalid argument | `EINVAL` |
| missing host bridge | `ELECTRON_MBT_HOST_UNAVAILABLE` |

Unsupported encodings, flags other than `r`/`w`, `mode`, `signal` and
callback-style `fs.readFile` fail closed. A non-window `run` has no host bridge,
so fs operations fail with `ELECTRON_MBT_HOST_UNAVAILABLE` rather than pretending
the file is missing.

## Deterministic fixture

`fixtures/nodeless-fs-app` registers an `fs:selftest` main handler and creates a
hidden window. `--fs-selftest` dispatches it after load and reports the result.
The test copies the fixture to a temporary directory first so the repository is
not modified.

```sh
moon build --target native native/nodeless
node scripts/build-macos-host.cjs
node --test tests/nodeless-runtime.test.cjs
```

Observed fields include UTF-8 and Buffer reads, async reads/writes, a 200,000-byte
round-trip, nested `.appData` creation, empty-file handling, base64 round-trip,
`EACCES` for app-root writes and outside-root reads, `EACCES` for traversal, a
symlink-escape `EACCES`, `ENOENT` for a missing file, and `EFBIG` for an
oversized write. A symlink variant of the test points `.appData/escape` outside
the app root and confirms denial.

## Moji settings persistence

The broker E2E now calls `setSettings({language:'ja'})` before `getSettings()`.
The runtime reports `settingsSetOk:true`, `settingsLanguage:"ja"` and
`settingsPersisted:true`; the harness independently reads
`.appData/moji/settings.json` and verifies `language === "ja"` before deleting the
temporary app. The original preload is still `NOT_EXECUTED`, and the settings
write is a test-scenario operation, not production consent.

## Verification

| command | result |
| --- | --- |
| `moon build --target native native/nodeless` | PASS |
| `node scripts/build-macos-host.cjs` | PASS |
| `node --test tests/nodeless-runtime.test.cjs` | 17 PASS |
| `node scripts/nodeless-moji-boot.cjs` | PASS |
| `node scripts/nodeless-moji-app.cjs` | PASS (settings persisted) |
| `moon test --target native` | 177 PASS |
| `moon test --target js` | 145 PASS |
| `npm test` | 472 PASS |
| `node scripts/preview-readiness.cjs` | NOT_READY (33 checks; expected exit 2) |
| ASAN / ownership review / external audit | NOT RUN |

## Limits

- main user-file grants are session-scoped and exact-file only; persistence,
  revocation, production directory consent and human panel interaction are open
  ([docs/0047](0047-nodeless-user-file-grants.md));
- directory APIs beyond the partial `statSync`/`readdirSync`/`mkdirSync` surface
  (`lstat`, recursive `readdir`, `rm`/`unlink`), streams, append flags,
  descriptors and callback-style `readFile` are unsupported; see
  [docs/0048](0048-nodeless-directory-fs.md);
- async fs is Promise-wrapped synchronous host I/O, not Node thread-pool I/O;
- atomic replace is not a CAS commit, does not preserve every Node metadata
  behavior, and is not a crash-durability proof;
- `.appData`/`.userData` currently live under the app root; packaged read-only
  app locations need a separate userData policy;
- canonicalization is checked before the write; a trusted-main TOCTOU window
  remains;
- `zlib`, updater behavior, original preload/contextBridge, strict profile and
  Electron compatibility remain open.

This is a main-side fs increment, not an Electron-compatible runtime release.
