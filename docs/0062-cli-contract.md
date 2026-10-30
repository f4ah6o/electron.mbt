# `emoon` CLI contract

Status: **implemented for the developer commands on Linux; macOS native
execution is NOT RUN.** Both implementations emit `compatible:false`. This is a
developer-tool contract, not a compatibility result.

## Two implementations, one command name

| command | native `emoon` | Node `emoon` |
| --- | --- | --- |
| `init` | implemented | implemented (reference) |
| `inspect` | implemented | implemented (reference) |
| `migrate` | implemented | implemented (reference) |
| `doctor` | implemented | delegates to native |
| `dev` | native staging + in-process doctor/run | node staging, then native doctor/run |
| `run` | implemented | delegates to native |
| `bundle` | implemented | delegates to native |
| `version` / `help` | implemented | implemented |

The native binary is built from `cmd/emoon` and ships with `emoon-host`.
`node scripts/build-cli.cjs` now builds release+strip by default; pass `--debug`
for the previous debug binary. The Node
binary is `cmd/emoon.cjs`; it is a development reference and never reimplements
the runtime. `emoon version` reports `impl:"native"` or `impl:"node"` and the
resolved native runtime path for the Node CLI.

The two implementations share the developer contract in
[`cli/emoon_contract`](../cli/emoon_contract/): argument parsing, config merge,
path rules, entry-type classification, the static scanner, the schema-2 manifest
writer and the adapted adapter generator. The Node reference remains the oracle;
`tests/emoon-cli-parity.test.cjs` compares reports, exit codes, stage bytes and
file modes.

## Native runtime resolution (Node CLI)

`--runtime` → `EMOON_RUNTIME` → `node_modules/electromoon/dist` → repository
`dist/` → `_build/native/{debug,release}/build/cmd/emoon` → `PATH`. Node scripts
are skipped. For the native runtime, `emoon-host` is resolved from `--host`,
`EMOON_HOST`, a sibling of the native binary, `dist/emoon-host` in the current
directory, or an absolute `PATH` entry.

The native `dev` command rejects `--runtime`: the native CLI is the runtime and
starts doctor/run in the same process. The Node `dev` and `bundle` commands keep
`--runtime` because they delegate to a resolved native binary. For `bundle`, the
Node CLI forwards a resolved host only when `EMOON_HOST` is unset; the native
command still owns the fallback chain.

## Exit codes

| code | meaning |
| --- | --- |
| 0 | requested operation succeeded / report produced / doctor ready |
| 1 | usage, I/O, invalid app, missing native runtime or host |
| 2 | blocked tier, blocked profile or preflight gate |

`compatible:true` is never emitted.

## Native commands

```sh
emoon init [app-dir] [--renderer <dir>] [--page <file>] [--include <path,...>] [--api <file>] [--asset-scheme <s,...>] [--force] [--config <file>]
emoon inspect [app-dir] [--renderer <dir>] [--api <file>] [--config <file>]
emoon migrate [app-dir] [--renderer <dir>] [--api <file>] [--asset-scheme <s,...>] [--out <dir>] [--force] [--reset-data] [--dry-run] [--config <file>]
emoon dev [app-dir] [--api <file>] [--asset-scheme <s,...>] [--build] [--no-launch] [--config <file>]
emoon run <app-dir> [--window] [--entry <file>] [--profile <id>] [--hold ... | --run-loop [--run-loop-seconds <n>]] [--menu-activate <label>] [selftests]
emoon doctor <app-dir> [--profile <id>]
emoon bundle [app-dir] [--output <file>] [--force] [--name <name>] [--host <path>] [--asset-scheme <s,...>] [--build] [--restage] [--reset-data] [--no-stage] [--dry-run] [--quiet] [staging options]
emoon version
emoon help
```

`--asset-scheme <scheme[,scheme]>` admits custom schemes for the adapted
asset broker. It is written to `.emoon/config.json` and the staged
`nodeless-app.json`; invalid/reserved names, duplicates or more than four
schemes fail before staging. The host serves admitted schemes on Linux only;
macOS does not serve them yet ([docs/0074](0074-custom-protocol-asset-broker.md)).

`doctor` validates the source manifest, file hashes, module graph, profile and
adapter without starting the engine, window or app. `run` keeps the existing
fixture and window modes. If `--entry` is omitted and the manifest entry is the
page, the runtime uses `package.json`'s `main` as the module entry. `--run-loop`
keeps a real window open until it closes (or `--run-loop-seconds` 0..3600;
0 means no time limit), pumping menu clicks, page requests and main timers; it
is the non-test app loop. `--menu-activate <label>` is a test-only helper that
activates a native menu item by exact label; it requires `--hold` or
`--run-loop`.

`bundle` packages a prepared stage into one self-extracting native ELF. With an
app directory it stages `.emoon/app` when missing or stale (including a
source-versus-stage comparison) and derives
`<app>/.emoon/dist/<name>-<version>-<os>-<arch>`; a prepared stage needs an
explicit `--output`. It validates every source-manifest hash before writing,
embeds the platform host and the stage (excluding app data), and uses zlib
compression. `--dry-run` writes nothing and returns the plan. The embedded
launcher accepts `--bundle-info`, `--version`, `--help` and the hold options;
other developer flags are rejected. See
[docs/0073](0073-one-step-bundle-ux.md) and
[docs/0072](0072-single-executable-bundle.md).

`--profile` admission: omitting it infers the profile from `nodeless-app.json`.
`electron-nodeless-adapted-v1` requires that file. `electron-nodeless-v1` exits
2 as blocked. `desktop-core-v1` and `moonbit-native-v1` exit 2 as engine
mismatches. Unknown IDs exit 2.

## Shared staging contract

- `init` writes `.emoon/config.json` (schema 1) and `.emoon/.gitignore`
  (`app/\n`). It never edits the app root `.gitignore` or source files.
- `inspect` writes nothing. The report keeps `compatible:false` and
  `claim:"not-a-compatibility-result"`.
- `migrate` stages into `.emoon/app` (or `--out`), writes
  `.emoon/migration-report.json`, and leaves the app source unchanged.
- `dev` runs init (when the config is absent), inspect, migrate, doctor and,
  unless `--no-launch`, `run --window --entry <config.main>`.
- The generated `source-manifest.json` is schema 2: the page is the manifest
  entry and every listed file is pinned by SHA-256 and byte count. The main
  module stays a separate file and is passed with `--entry`.
- The generated `nodeless-app.json` and `adapted/page-api.js` are schema 1 and
  byte-identical between the two implementations on the parity fixtures.
- `migration-report.json` contains the observed tier, blockers, warnings,
  generated hashes and `compatible:false`.
- `dev --no-launch` stops after doctor and prints the `run --hold` command for
  manual inspection. `dev --build` is the only path that invokes npm.

### Source trees, build output and `--build`

`dev` consumes an already-built app: `package.json` `main` and the renderer
output must exist. The preflight order is package.json → main → renderer, so an
unbuilt source tree fails with:

```json
{"ok":false,"compatible":false,"code":"ELECTRON_MBT_MIGRATE_BUILD_MISSING","message":"package.json main \"out/main/main.js\" does not exist; build the app first (npm run build) or pass emoon dev --build"}
```

- `dev --build` is an explicit opt-in. It checks `scripts.build` and
  `node_modules/`, runs `npm run build` in the app root, then continues with
  init/inspect/migrate/doctor. It never runs `npm install`.
- The child build writes stdout to **stderr**, so `emoon`'s JSON stdout stays
  parseable. `--build` is a developer convenience; the runtime itself remains
  Node-free.
- The build may rewrite the app's build output. `sourceUnchanged` in the
  migration report refers to migrate, not to the user-requested build.
- A missing output after `--build` is still `BUILD_MISSING`; a missing build
  script or a nonzero build is `ELECTRON_MBT_MIGRATE_BUILD`; missing
  dependencies is `ELECTRON_MBT_MIGRATE_BUILD_DEPS`.
- When `dirname(main)` is not the app root, the whole main output directory is
  staged (for example `out/main/main.js` plus `out/main/pngWorker.js`), so
  multi-entry main builds resolve. A main at the app root stages only the entry
  unless `--include` adds siblings.

### Limits and refusal rules

- 4096 staged files, 64 MiB total, 16 MiB per file.
- Static scan: `.js`/`.cjs`/`.mjs`/`.ts`/`.tsx`, 1 MiB per file, 4 MiB total,
  and a 1 MiB main-file preload check.
- Inspect walk: 16384 entries, 8192 files, 256 MiB total, 32 MiB per file,
  depth 64.
- Any symlink under the app tree, a symlinked stage, `package.json` or config is
  `ELECTRON_MBT_MIGRATE_SYMLINK`. This is intentionally stricter than silently
  following links, and matches the migration refusal rule.
- Inspect skips `.git`, `.emoon` and `node_modules` at any depth. Staging also
  skips these trees; a source checkout can therefore be inspected without
  walking dependency files or `node_modules/.bin` symlinks.
- The generated stage never contains `node_modules`; dependencies must be
  bundled into the build output. Symlinks in the remaining tree still fail
  closed.
- An existing stage is not replaced without `--force`. A stage containing
  `.appData` or `.userData` is not replaced without `--reset-data`.
- `--force` normally removes the stage. If removal fails (for example when the
  stage was created by another UID), the stage is atomically moved to
  `.emoon/app.stale` (or `.stale-N`) and a warning goes to stderr; a fresh stage
  is then created. The stale tree is retained for manual removal, is never used,
  and is skipped by inspect. With `--reset-data`, app data inside the stale tree
  is likewise retained; the warning names the path. `.emoon/.gitignore` ignores
  `app.stale*/`.
- `--out` equal to the app root, outside the app root, or a symlink is rejected.
  `--config` is app-relative, must stay inside the app root, and its directory is
  the report workspace.
- Empty files are skipped while walking; an empty main, page or `package.json`
  is rejected.
- Path escapes, non-regular files and limits are fail-closed; errors print
  `{ok:false, compatible:false, code, message}` and exit 1.

### Entry resolution

The native CLI resolves `package.json` `main` with the same absolute-path subset
as `require.resolve`: exact file, then `.js`/`.json`/`.node` when the path has no
extension, then a directory's `package.json` `main` and `index.js`/`index.json`/
`index.node`. Package `exports` and conditional resolution are not used; a path
that only resolves through them fails with `ELECTRON_MBT_ENTRY_MISSING` instead
of guessing. `entryType` comes from the resolved `package.json` main (`app.entry`),
while the preload scan reads the configured `main`; this mirrors the reference.

## Node commands

```sh
emoon init [app-dir] [--renderer <dir>] [--page <file>] [--include <path,...>] [--api <file>] [--asset-scheme <s,...>] [--force] [--config <file>]
emoon inspect [app-dir] [--renderer <dir>] [--api <file>] [--config <file>]
emoon migrate [app-dir] [--renderer <dir>] [--api <file>] [--asset-scheme <s,...>] [--out <dir>] [--force] [--reset-data] [--dry-run] [--config <file>]
emoon dev [app-dir] [--api <file>] [--asset-scheme <s,...>] [--build] [--no-launch] [--config <file>] [--runtime <path>]
emoon doctor <stage> [--runtime <path>]
emoon run <stage> [--window] [--entry <file>] [--run-loop [--run-loop-seconds <n>]] [--menu-activate <label>] [--runtime <path>]
emoon version | --version
emoon help | --help
```

The Node CLI writes `.emoon/` only. It does not copy the original preload, does
not execute it, and does not claim Electron compatibility.

## Evidence boundary

Linux parity is automated by `tests/emoon-cli-parity.test.cjs` and the window E2E
uses the real GTK/WebKitGTK host. macOS native execution of these commands is
NOT RUN in this environment; the macOS CI job is the first place it is
exercised. Human dialog UI, signing, publication and `moon binstall` remain NOT
RUN.

## Legacy Node CLI

`cmd/legacy-node.cjs` retains the Node-backed `desktop-core-v1` diagnostics
(`snapshot`, `doctor`, `compat-check`, `run`, `pack`) and the experimental
`run --experimental-m1` path. It is not installed as `emoon` and is not the
product CLI.
