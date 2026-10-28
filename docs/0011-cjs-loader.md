# In-memory CJS loader (EP-11 / MOD-01 partial)

Status: **partial**. The core module registry, a real QuickJS CJS execution
leaf, a bounded Node/Electron prelude and a Node-free fixture graph are
implemented and tested. The pinned Moji main graph now runs in the native
window host, and the real renderer boots under the generated adapted page API;
the original preload, `fs`/zlib/updater behavior, dynamic require and ESM remain
open. This is not an app or Electron compatibility claim.

## Ownership

| Layer | Owns |
| --- | --- |
| `runtime/modules/module.mbt` | module IDs, source hashes, kind, load state, dependency edges, limits and admission |
| `bridges/embedded-js/cjs_loader.mbt` | validated/pre-resolved graph execution in one QuickJS context |
| JavaScript realm | `module.exports`, `exports` alias, wrapper function, cache object identity |

The JS leaf does not resolve paths or read files. It receives a graph whose
dependency edges have already been resolved by MoonBit; `require(specifier)`
only follows a declared edge. This keeps module policy out of a parallel JS
state machine.

## Contract

- Duplicate/empty IDs, missing dependency targets, unknown entry points,
  more than 4,096 modules and more than 4 MiB of source are rejected before JS
  evaluation.
- A module record is inserted in `Loading` state; the JS cache is populated
  before the wrapper runs so cycles observe the partially initialized exports
  object.
- `module.exports` reassignment and JSON modules are supported for the tested
  in-memory profile.
- The wrapper receives `__filename`/`__dirname` and uses `exports` as `this`;
  `process`/`Buffer` are realm globals installed by the prelude, matching the
  Node wrapper rather than shadowing module-level declarations.
- `require('node:...')` builtins are resolved from a single prelude object;
  `fs`/`fs/promises` import-only with ENOENT/EACCES, `zlib` import-only with a
  host-backed `createDeflate` (stored fallback), and `electron-updater` an import-only adapted
  stub; real file/update/stream behavior is not implemented.
- Require-selected package `exports` and package `main` are resolved by MoonBit;
  an `exports` package never falls back to an unexported subpath or `main`.
- A wrapper syntax error, thrown error or missing declared dependency is a
  typed failure; it is not converted to an empty module.
- `cacheCount`/`cacheIds` are recorded for evidence. They are realm-local
  identity observations, not a Node compatibility proof.

## Resolution

`runtime/modules/resolve.mbt` resolves relative specifiers against an immutable
`FileIndex` supplied by the host:

- exact `.js`/`.cjs`/`.json`, extension probing and directory index
- package `main` metadata for a directory candidate
- package specifiers and subpaths through registered `node_modules` directories, including scoped names and nested packages
- package-main/subpath escape rejection
- path normalization, root-escape rejection and unsupported `.node`/TS rejection
- a 16-step package-main recursion bound

The index is a path/metadata snapshot; it does not read the live filesystem.
Package specifiers (`electron`, nested `node_modules`), exports/imports and
conditional resolution are intentionally unsupported in this increment.

## Verified

`moon test --target native -p bridges/embedded-js` and the full native suite
pass, and `native/nodeless` runs `fixtures/nodeless-app` without Node:

- CJS cycle A↔B with partial exports
- shared dependency evaluated once (cache identity)
- `module.exports` reassignment
- JSON module
- duplicate ID, missing entry, missing dependency and syntax-error rejection
- relative file/extension/directory/package-main resolution and escape/unsupported rejection
- root/nested/scoped package resolution over a registered `node_modules` index
- Node/Electron prelude values, sync/async dispatch, nextTick→jobs→timer order
  and typed `node:fs` rejection in the Node-free fixture

`moon test --target js`/native also pass the pure `ModuleRegistry` contract
tests for duplicate/unknown/limit/state transitions and cycle edges.

## Open

- `imports`, wildcard/pattern exports, symlinked package identity and live package discovery
- real `fs`/`fs/promises`, zlib stream, updater behavior and the native file broker
- dynamic/computed require, ESM and Node-API
- a pinned Node oracle differential for the broader MOD matrix
- the original preload/contextBridge and the full Moji/jmd app scenario; the
  Node-less renderer currently uses the generated adapted page API
