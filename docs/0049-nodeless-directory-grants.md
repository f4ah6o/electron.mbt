# Node-less main directory grants

Status: **partial directory-grant increment**. A trusted QuickJS main can use a
session-scoped directory grant to `stat`, list, read, write and `mkdir` inside
that canonical subtree. Grants are test-injected through the private CLI
control; a real native directory picker, persistence and revocation remain
open. `compatible:false`, adapted **partial**, strict **blocked** and the
original preload **NOT_EXECUTED** are unchanged.

## What works

`--window` installs the private host bridge before main evaluation. The new
private control `grant-main-directory` registers an existing canonical
directory with read, write or readwrite bits. The existing JavaScript `fs`
surface then consults that registry; no new JavaScript API is added.

| Operation | Read grant | Write grant | Readwrite grant |
| --- | --- | --- | --- |
| `statSync` / `existsSync` on the directory or descendant | yes | no (`EACCES` / `false`) | yes |
| `readdirSync` on the directory or descendant | yes | no (`EACCES`) | yes |
| `readFileSync` on a descendant file | yes | no (`EACCES`) | yes |
| `writeFileSync` on a descendant file | no (`EACCES`) | yes | yes |
| `mkdirSync` on the directory or descendant | no (`EACCES`) | yes | yes |
| Promise wrappers | same as their synchronous counterpart | same | same |

A readwrite grant therefore supports the same partial `Stats`/`Dirent` objects
and bounded listing behavior as the app-root surface. Exact-file grants are
unchanged: a granted file can be stat'ed/read/written, but its parent cannot be
listed and `mkdir` beside it remains denied.

## Grant sources and lifetime

| Source | Mode | Notes |
| --- | --- | --- |
| `nodeless-directory.json` + `--directory-selftest` | read / write / readwrite | Test-only scenario; explicit flag required. |
| Private `grant-main-directory` control | read / write / readwrite | CLI only; not in the QuickJS host-operation allowlist. |
| Native directory picker | none | **NOT IMPLEMENTED**; no production consent path is claimed. |

Grants are app-session state. They survive a renderer reload and are cleared by
host shutdown. They are never persisted across application restarts and there is
no revocation UI.

## Policy and bounds

| Item | Value |
| --- | --- |
| grant unit | one canonical existing directory; the whole subtree is in scope |
| grant bits | read `1`, write `2`, readwrite `3`; duplicate grants merge |
| grants per host session | 16 distinct canonical directories |
| root grant | `/` is rejected |
| path limit | 4,096 UTF-16 code units, no NUL |
| canonicalization | `realpath`; escaping or dangling symlink targets are denied |
| prefix matching | component-aware (`grant/` prefix), so `/tmp/grant-evil` is outside `/tmp/grant` |
| write parent creation | not enabled by a directory grant; a missing parent is `EIO` until `mkdir` creates it |
| `mkdir` mode | `0700` per created component; recursive creation is not atomic |
| read limit | 262,144 bytes per file |
| write limit | 262,144 bytes per file |
| listing limit | 4,096 entries and 512 KiB of names per call |
| recursive `mkdir` limit | 64 new components per call |
| `readdir` order | host/filesystem order; no sorting guarantee |
| lifetime | host session; no persistence, revocation or directory streams |

Bounds are applied after the grant check and are not widened by a grant. A
directory grant also does not enable `lstat`, `rm`/`unlink`, streams, file
descriptors, recursive `readdir`, `realpath`, callback-style APIs or true
thread-pool I/O.

## Privilege separation

The QuickJS app main is trusted app code, but it may request bounded file
operations, not mint authority. `grant-main-directory` is a private CLI control;
`native/nodeless/host_client.c` keeps it outside the JavaScript allowlist, so
app code receives `ELECTRON_MBT_HOST_REQUEST_DENIED`. The page realm cannot
reach the private host channel. A directory grant does not authorize the
renderer broker, a new window, a different session or a parent/sibling path.

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

Invalid grant scenarios fail at setup with
`ELECTRON_MBT_NODELESS_DIRECTORY`. A denied path does not disclose whether it
exists.

## Deterministic fixture

`fixtures/nodeless-directory-app` registers `directory:selftest` and creates a
hidden window. The test copies the fixture, creates a read directory, a
readwrite directory, a write-only directory, a prefix sibling, an outside
target and symlinks, then writes `nodeless-directory.json` and runs:

```sh
nodeless.exe run <temp-app> --window --directory-selftest --entry src/main.js
```

The fixture covers:

- read listing, `Dirent`, file/directory `stat`, sync and Promise reads,
  `existsSync`;
- readwrite listing, recursive `mkdir` (`firstCreated`), sync/Promise write,
  read-back and directory `stat`;
- write-only write/mkdir success plus read/list/stat denial;
- read-only write/mkdir denial;
- denied prefix sibling and denied file read/write/list/stat/mkdir;
- escaping symlinks inside read and write grants;
- `..` traversal and missing-parent write;
- 4,097-entry listing, oversized read and oversized write bounds;
- app-code attempts to call `grant-main-directory` and `grant-main-file`
  directly.

## Verification

Environment: macOS 26.5.2 arm64, Node 24.22.0, pinned QuickJS 2026-06-04,
`dist/electron-mbt-native-host` rebuilt from the same tree.

| command | result |
| --- | --- |
| `moon build --target native native/nodeless` | PASS |
| `node scripts/build-macos-host.cjs` | PASS |
| `node --test tests/nodeless-runtime.test.cjs` | 20 PASS |
| `moon test --target js` | 145 PASS |
| `moon test --target native` | 177 PASS |
| `npm test` | 475 PASS |
| `node scripts/nodeless-moji-app.cjs` | PASS |
| `node scripts/nodeless-moji-boot.cjs` | PASS |
| `node scripts/preview-readiness.cjs` | NOT_READY (expected exit 2) |
| `node scripts/verify-state.cjs` | NOT_READY |
| ASAN / ownership review / external audit | NOT RUN |

## Limits

- no native directory picker or human consent for directory grants;
- no grant persistence, revocation, policy migration or user-facing manager;
- grants cover the whole subtree; there is no per-operation or per-child
  refinement, quota or deny rule;
- canonicalization is checked before the operation, so a trusted-main TOCTOU
  window remains;
- a directory grant does not create missing write parents automatically;
- a write-only grant cannot be stat'ed or listed, so callers cannot enumerate
  what they can write;
- symlink entries are listed but never followed for listing/stat/read/write;
- `mkdir` applies `0700`, rejects explicit `mode` and is not atomic;
- streams, `lstat`, `rm`/`unlink`, recursive listing, descriptors, `zlib`,
  updater behavior, the original preload/contextBridge and the strict profile
  remain open.

This is a directory-grant increment for the Node-less adapted profile, not an
Electron-compatible runtime release.
