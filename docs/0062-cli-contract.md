# `emoon` CLI contract

Status: **partial**. The Node reference CLI is implemented; the native CLI is
implemented for the runtime and preflight commands.

## Two implementations, one command name

| command | native `emoon` | Node `emoon` |
| --- | --- | --- |
| `init` | not implemented | implemented (reference) |
| `inspect` | not implemented | implemented (reference) |
| `migrate` | not implemented | implemented (reference) |
| `doctor` | implemented | delegates to native |
| `dev` | not implemented | node staging, then native doctor/run |
| `run` | implemented | delegates to native |
| `version` / `help` | implemented | implemented |

The native binary is built from `cmd/emoon` and ships with `emoon-host`. The Node
binary is `cmd/emoon.cjs`; it is a development reference and never reimplements
the runtime. `emoon version` reports `impl:"native"` or `impl:"node"` and the
resolved native runtime path for the Node CLI.

## Native runtime resolution (Node CLI)

`--runtime` → `EMOON_RUNTIME` → `node_modules/electromoon/dist` → repository
`dist/` → `_build/native/{debug,release}/build/cmd/emoon` → `PATH`. Node scripts
are skipped. `emoon-host` is resolved from `--host` (not implemented as a flag
yet), `EMOON_HOST`, the same directory as the native binary, `dist/`, or `PATH`.

## Exit codes

| code | meaning |
| --- | --- |
| 0 | requested operation succeeded / report produced / doctor ready |
| 1 | usage, I/O, invalid app, missing native runtime or host |
| 2 | blocked tier, blocked profile or preflight gate |

`compatible:true` is never emitted.

## Native commands

```sh
emoon run <app-dir> [--window] [--entry <file>] [--profile <id>] [--hold ...] [selftests]
emoon doctor <app-dir> [--profile <id>]
emoon version
emoon help
```

`doctor` validates the source manifest, file hashes, module graph, profile and
adapter without starting the engine, window or app. `run` keeps the existing
fixture and window modes. If `--entry` is omitted and the manifest entry is the
page, the runtime uses `package.json`'s `main` as the module entry.

`--profile` admission: omitting it infers the profile from `nodeless-app.json`.
`electron-nodeless-adapted-v1` requires that file. `electron-nodeless-v1` exits
2 as blocked. `desktop-core-v1` and `moonbit-native-v1` exit 2 as engine
mismatches. Unknown IDs exit 2.

## Node commands

```sh
emoon init [app-dir] [--renderer <dir>] [--page <file>] [--include <path,...>] [--api <file>] [--force]
emoon inspect [app-dir] [--renderer <dir>] [--api <file>] [--config <file>]
emoon migrate [app-dir] [--renderer <dir>] [--api <file>] [--out <dir>] [--force] [--reset-data] [--dry-run]
emoon dev [app-dir] [--api <file>] [--no-launch] [--runtime <path>]
emoon doctor <stage> [--runtime <path>]
emoon run <stage> [--window] [--entry <file>] [--runtime <path>]
emoon version | --version
emoon help | --help
```

The Node CLI writes `.emoon/` only. It does not copy the original preload, does
not execute it, and does not claim Electron compatibility.

## Legacy Node CLI

`cmd/legacy-node.cjs` retains the Node-backed `desktop-core-v1` diagnostics
(`snapshot`, `doctor`, `compat-check`, `run`, `pack`) and the experimental
`run --experimental-m1` path. It is not installed as `emoon` and is not the
product CLI.
