# Node-less main user-file grants

Status: **partial user-file increment**. The trusted QuickJS main can read and
write exact user files outside the app root when a native open/save/export panel
or the explicit `--user-file-selftest` scenario grants them. Grants are
session-scoped and exact-path only; persistence, revocation, production
directory consent and human panel interaction remain open. `compatible:false`, adapted **partial**,
strict **blocked** and the original preload **NOT_EXECUTED** are unchanged.

## What works

`--window` already installs the private host bridge before main evaluation. This
increment adds a host-level grant registry that `fs.existsSync`,
`fs.readFileSync`, `fs.writeFileSync`, `fs.promises.readFile` and
`fs.promises.writeFile` consult without changing the JavaScript API:

| API | Behavior with a session grant |
| --- | --- |
| `fs.existsSync(path)` | `true` for an existing granted path; `false` for missing, ungranted or host-unavailable paths. |
| `fs.statSync(path, options?)` | Partial Stats for a granted file; ungranted paths stay `EACCES`. Exact grants do not make the parent directory listable. |
| `fs.readFileSync(path, options?)` | Same Buffer/string handling as app-root reads; the path may be outside the app root. |
| `fs.writeFileSync(path, data, options?)` | Atomic replace for an exact granted write target. |
| `fs.promises.readFile` / `writeFile` | Promise wrappers over the same bounded synchronous host call. |

The renderer's adapted page API is unchanged. A completed open/save/export panel
also records the selected path for main, so the page broker and main see the
same user decision.

## Grant sources

| Source | Mode | Notes |
| --- | --- | --- |
| Native open panel | read | Test-injected `set-dialog-result` uses the same grant method. |
| Native save panel | readwrite | The target may not exist yet; its parent must exist. |
| Native export panels | readwrite | HTML/PDF/PNG exports use the same rule. |
| `nodeless-user-file.json` + `--user-file-selftest` | read + readwrite | Test-only scenario; explicit flag required. |

`grant-main-file` is a private host control operation. The MoonBit CLI may call
it; the QuickJS host bridge and the page adapter may not. A dialog fails closed
if the main grant cannot be recorded, rather than reporting a renderer-only
success.

## Policy and bounds

| Item | Value |
| --- | --- |
| grant scope | one canonical file path (an existing regular file, or a new write target with an existing parent); no directory subtree |
| grant bits | read `1`, write `2`, readwrite `3`; duplicate grants merge |
| grants per host session | 64 distinct paths |
| path limit | 4,096 UTF-16 code units, no NUL |
| existing target | must be a regular file; dangling symlinks are rejected |
| new write target | immediate parent must already be a directory |
| read limit | 262,144 bytes |
| write limit | 262,144 bytes |
| write mode | Cocoa atomic replace (`atomic-replace-v1`) |
| lifetime | host session; not persisted, no revocation API |
| reload | main grants survive a renderer reload; they are app-session state |

Relative paths still resolve from the app root. User-granted paths are
canonicalized with `realpath` (or the nearest existing ancestor for a new write
target) before the grant is stored.

## Privilege separation

The QuickJS app main is trusted app code, but it may request file I/O, not mint
its own authority. `native/nodeless/host_client.c` now registers an explicit
JavaScript allowlist instead of the full CLI control surface. App code can call
window/load/main-fs operations only. `grant-main-file`, `grant-file`,
`set-dialog-result`, renderer probes, ingress release, `app-reply`, `shutdown`
and similar control operations return
`ELECTRON_MBT_HOST_REQUEST_DENIED`.

The page realm cannot reach the private host channel. Its ingress remains the
bounded `app-request` path, and the adapter exposes no generic host request.

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
| non-allowlisted QuickJS host operation | `ELECTRON_MBT_HOST_REQUEST_DENIED` |

An ungranted outside-root path reports `EACCES` for read/write and `false` for
`existsSync`; it does not disclose whether the path exists. A user-granted write
with a missing parent fails; missing parents are created only under `.appData`
and `.userData`.

## Deterministic fixture

`fixtures/nodeless-user-file-app` registers a `userfile:selftest` main handler
and creates a hidden window. The test copies the fixture to a temporary
directory, creates read/write/denied files in a separate temporary directory,
writes `nodeless-user-file.json`, and runs:

```sh
nodeless.exe run <temp-app> --window --user-file-selftest --entry src/main.js
```

Observed fields include synchronous and Promise reads, a granted write with
read-back, `existsSync` for granted and ungranted paths, `EACCES` denials for an
ungranted read and write, and `ELECTRON_MBT_HOST_REQUEST_DENIED` for app-code
attempts to call `grant-main-file` and `grant-file`.

## Verification

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

- grants are not persisted across app restarts and there is no revocation UI;
- exact-file grants only; directory grants are a separate model
  ([docs/0049](0049-nodeless-directory-grants.md)), not recursive or wildcard
  file grants;
- a granted file can be stat'ed/read/written, but its parent cannot be listed and
  `mkdirSync` next to it is denied; directory access uses the separate
  directory-grant model;
- the real human open/save panel flow is **NOT RUN**; test injection exercises
  the same native grant methods but is not production consent;
- user-file writes use atomic replace, not Node's truncate/write or metadata
  preservation;
- canonicalization is checked before the read/write; a trusted-main TOCTOU
  window remains;
- read/write limits are 256 KiB, so larger user files fail `EFBIG`;
- production directory consent, stream/callback-style `fs`, true thread-pool
  I/O, `zlib`, updater, the original preload/contextBridge and strict profile
  remain open
  (bounded directory/metadata calls exist only for the app/data roots; see
  [docs/0048](0048-nodeless-directory-fs.md)).

This is a session user-file increment, not an Electron-compatible runtime
release.
