# Migrating an existing Electron app (experimental)

Status: **Node reference flow implemented; native ports pending**. This is not a
compatibility result and does not modify the app source.

## Prerequisites

- The app already builds its main process to CommonJS and its renderer to static
  assets. Bundle the main process first; the runtime consumes the build output.
- No native addons, ASAR, ESM main or Node-only Electron features.
- The main entry is `package.json`'s `main`.
- The renderer entry is a static page, by default `<renderer>/index.html`.

## Flow

```sh
# from the runtime repository
node scripts/build-cli.cjs

# from the Electron app repository
node /path/to/electromoon/cmd/emoon.cjs init
node /path/to/electromoon/cmd/emoon.cjs inspect
node /path/to/electromoon/cmd/emoon.cjs migrate
node /path/to/electromoon/cmd/emoon.cjs doctor
node /path/to/electromoon/cmd/emoon.cjs dev
```

`init` writes `.emoon/config.json` and `.emoon/.gitignore` (`app/`). It never
edits the app's root `.gitignore` or source files. `inspect` writes nothing.
`migrate` stages the build output into `.emoon/app` and writes a report.
`doctor` validates the stage without launching it. `dev` runs init, inspect,
migrate and doctor, then starts the native window.

## Tiers

| tier | meaning |
| --- | --- |
| `plain` | no preload API is declared; the manifest and package output are staged |
| `adapted` | a preload API manifest is supplied; a page adapter and profile are generated |
| `blocked` | a native addon, ASAR, ESM main, path escape, adapter error or limit prevents staging |

The tier is a routing hint, not a compatibility verdict. `blocked` exits 2.

## Generated files

- `.emoon/config.json`: `{schema, main, renderer, page, include, api}`.
- `.emoon/app/source-manifest.json`: schema 2, entry is the page, every file is
  pinned by SHA-256 and byte count. The main module is listed separately and is
  passed with `--entry` at run time.
- `.emoon/app/nodeless-app.json`: adapted profile and adapter path.
- `.emoon/app/adapted/page-api.js`: generated page API.
- `.emoon/migration-report.json`: observations, blockers, generated hashes and
  `compatible:false`.

## Limits and refusal rules

- 4096 files, 64 MiB total, 16 MiB per file, bounded scan (1 MiB per JS file,
  4 MiB total).
- Symlinks, path escapes and non-regular files are rejected.
- An existing stage is not replaced without `--force`.
- A stage containing `.appData` or `.userData` is not replaced without
  `--reset-data`.
- `--out` equal to the app root is rejected.
- Empty files are skipped with a warning; an empty main or page is rejected.

## Data and rollback

The stage is disposable. `.appData` and `.userData` live under the stage and are
not migrated from an existing Electron installation. Keep the Electron build and
its data; do not point this preview at production user data. There is no
automatic rollback, signing or update channel.

## Current gap

The Node CLI is the reference implementation of `init`, `inspect`, `migrate` and
`dev`. The native `emoon` binary implements `run`, `doctor`, `version` and
`help`; native `init`/`inspect`/`migrate`/`dev` are not implemented yet. When both
CLIs are installed, `emoon version` identifies the implementation.
