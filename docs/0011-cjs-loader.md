# In-memory CJS loader (EP-11 / MOD-01 partial)

Status: **partial**. The core module registry and a real QuickJS CJS execution
leaf are implemented and tested. Filesystem resolution, package.json/main/index
rules, Node builtins, dynamic require diagnostics and the pinned Node oracle are
not yet connected. This is not an app loader or Electron compatibility claim.

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
pass:

- CJS cycle A↔B with partial exports
- shared dependency evaluated once (cache identity)
- `module.exports` reassignment
- JSON module
- duplicate ID, missing entry, missing dependency and syntax-error rejection
- relative file/extension/directory/package-main resolution and escape/unsupported rejection
- root/nested/scoped package resolution over a registered `node_modules` index

`moon test --target js`/native also pass the pure `ModuleRegistry` contract
tests for duplicate/unknown/limit/state transitions and cycle edges.

## Open

- exports/imports, conditional resolution, symlinked package identity and live package discovery
- filesystem source acquisition, source hashes and source maps
- `require('electron')` identity, Node builtin allowlist and unsupported-symbol diagnostics
- dynamic/computed require, package exports/imports and ESM
- pinned Node oracle differential (MOD-01/02/03/04)
- loading the actual Moji/jmd emitted graphs
