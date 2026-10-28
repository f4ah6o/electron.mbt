# One-command bundling UX

Status: **implemented and verified on Linux x86_64**. `compatible:false`; this is
a packaging/developer-tool feature, not an Electron compatibility result. macOS
bundle execution, signing and notarization are NOT RUN.

## What changed

Before this increment a human needed three emoon commands and a hand-written
output path:

```sh
emoon init
emoon migrate
emoon bundle .emoon/app --output build/app
```

`emoon bundle` now stages a built Electron app when needed and derives the output
path. The emoon-specific work is one command:

```sh
cd my-electron-app
npm install && npm run build     # the app's normal build; or: emoon bundle --build
emoon bundle
./.emoon/dist/my-app-1.0.0-linux-x64
```

The two-step form is still supported for prepared stages and CI:

```sh
emoon migrate --api adapted-preload.json
emoon bundle .emoon/app --output build/my-app
```

## Command surface

```text
emoon bundle [app-dir] [options]

app-dir           default "."
--output <file>   explicit output (requires --force when it exists)
--force           replace an existing explicit output
--name <name>     override the embedded app name and the default file-name base
--host <path>     native host binary
--build           run the app's npm build first
--restage         re-stage even when the existing stage is valid
--reset-data      delete .appData/.userData while re-staging
--no-stage        never init/migrate; require a valid stage
--dry-run         print the plan and write nothing
--quiet           hide stderr progress
--renderer <dir>  forwarded to emoon init/migrate
--page <file>     forwarded to emoon init/migrate
--api <file>      forwarded to emoon init/migrate
--include <paths> forwarded to emoon init/migrate
--config <file>   forwarded to emoon init/migrate
--help            show the packaging help
```

`--out` is not a bundle option. It is a staging option; use the two-step form
when a custom stage path is required. `--runtime` belongs to the Node reference
CLI.

Two input modes exist:

- **app directory**: the default. `<app>/.emoon/app` is the stage. The app root
  must contain `package.json`; a missing one is `ELECTRON_MBT_BUNDLE_INPUT`.
- **prepared stage**: `<input>/source-manifest.json` exists. `--output` is
  required; staging flags are rejected.

## Default output

```text
<app>/.emoon/dist/<name>-<version>-<platform>-<arch>
```

- `name` is `--name`, else the staged `package.json` name, else the directory.
- `version` is the staged `package.json` version, else `0.0.0`.
- `platform` and `arch` come from the running host (`linux`/`darwin`,
  `x64`/`arm64`).
- The file-name slug is lowercase `[a-z0-9_-]`; every other run becomes one `-`;
  the base is limited to 48 characters and is never empty. `@scope/app` becomes
  `scope-app`; `2.0.0+build` becomes `2.0.0-build`.
- `.emoon/dist/.gitignore` (`*\n`) is created when absent. The app's own
  `.gitignore` is not edited.
- A derived output is an emoon-owned build artifact and is replaced
  atomically on the next run. An explicit `--output` is only replaced with
  `--force`; it is resolved from the current directory, while the derived
  output is placed under the app root.
- The output is written next to a temporary file and renamed, so a failed write
  does not leave a partial executable. The container format is unchanged.

## Stage lifecycle

`emoon bundle` reads `<app>/.emoon/app/source-manifest.json`, verifies every
listed file's SHA-256 and byte count, then compares the stage with the current
source:

- every file that `migrate` would currently collect must be in the manifest with
  the same hash;
- every non-generated manifest file must still exist in the app source;
- when the config has an API manifest, `adapted/page-api.js` is regenerated in
  memory and compared byte-for-byte.

| observed state | action |
| --- | --- |
| missing stage | `init` when the config is absent, then `migrate`, then bundle |
| ready stage | reuse as-is |
| source changed / stage hash mismatch | re-stage automatically, then bundle |
| `--no-stage` | never write; `BUNDLE_STAGE` (missing) or `BUNDLE_STALE` (mismatch) |
| `--restage` | re-stage even when ready |
| `--reset-data` | implies re-stage and deletes stage `.appData`/`.userData` |
| stage contains `.appData`/`.userData` without `--reset-data` | `BUNDLE_STALE`; data is preserved |

The stage itself is never deleted implicitly when it contains app data. The
existing `migrate` limits, symlink rules and stale-stage move-aside behavior are
reused; `bundle` does not run its own copy of the staging policy.

The current bundle profile is `electron-nodeless-adapted-v1`, so a stage without
`nodeless-app.json` is rejected with `nodeless-app.json is missing (stage with
--api <file> ...)`. Plain stages are not a bundle input in this increment.

## Output contract

stdout is JSON: exactly one line for a successful bundle, a dry run or a bundle
error. Human progress goes to stderr as `[emoon] ...` and is suppressed by
`--quiet`.

Success (the C report plus CLI-owned fields):

```json
{"schema":1,"status":"bundled","format":"emoon-single-v1","output":"/abs/.emoon/dist/my-app-1.0.0-linux-x64","bytes":6231768,"sha256":"...","storedBytes":3693792,"rawBytes":13108339,"compression":"zlib","app":{"name":"moji","version":"1.0.7","files":144,"bytes":12959604},"host":{"sha256":"...","bytes":140048},"compatible":false,"claim":"not-a-compatibility-result","command":"bundle","stage":{"mode":"reused","root":"/abs/.emoon/app","files":143},"replaced":true,"next":{"run":"/abs/.emoon/dist/moji-1.0.7-linux-x64","info":"/abs/.emoon/dist/moji-1.0.7-linux-x64 --bundle-info"}}
```

`stage.mode` is `staged`, `reused` or `direct`. `stage.files` counts manifest
entries; the C `app.files` count includes `source-manifest.json`.

Dry run:

```json
{"schema":1,"product":"electromoon","command":"bundle","status":"planned","app":{"root":"/abs","name":"my-app","version":"1.0.0"},"stage":{"state":"missing","root":"/abs/.emoon/app","files":0},"host":{"path":"/abs/dist/emoon-host"},"output":"/abs/.emoon/dist/my-app-1.0.0-linux-x64","actions":["init","stage","bundle"],"replaceOutput":false,"compatible":false,"claim":"not-a-compatibility-result"}
```

`--dry-run` performs the same input, build, stage-state, host and output checks
but writes nothing and does not run npm. A missing build is still reported.

Error:

```json
{"schema":1,"product":"electromoon","command":"bundle","ok":false,"status":"FAIL","code":"ELECTRON_MBT_BUNDLE_STALE","message":"...","hint":"...","compatible":false}
```

Codes: `ELECTRON_MBT_BUNDLE_USAGE`, `_INPUT`, `_BUILD_MISSING`, `_STAGE`,
`_STALE`, `_HOST`, `_APP`, `_EXISTS`, `_OUTPUT`, `_IO`, `_COMPRESS`, `_SELF`,
`_ARGUMENT`, `_CORRUPT`; runtime extraction keeps `_HOME`, `_LOCK`, `_EXTRACT`,
`_ENV`. Nested `init`/`migrate` failures keep their shared staging codes.
Exit codes: 0 success/plan/help, 1 usage/input/stage/host/IO, 2 blocked tier.

## Host resolution

`emoon bundle` resolves `emoon-host` in this order:

1. `--host`
2. `EMOON_HOST`
3. the test-only repository override (unchanged)
4. a sibling `emoon-host` next to the running `emoon`
5. `dist/emoon-host` relative to the current directory (development layout)
6. an absolute `PATH` entry containing an executable `emoon-host`
7. otherwise the literal `dist/emoon-host`, which the CLI turns into
   `ELECTRON_MBT_BUNDLE_HOST` with an actionable hint

The bundle launcher sets `EMOON_HOST` itself, so an app cannot redirect host
resolution. PATH search accepts only absolute directories; a relative `.` entry
is ignored.

## Node reference CLI

`node cmd/emoon.cjs bundle ...` strips `--runtime`, resolves the native runtime
exactly as `doctor`/`run` do, and delegates with inherited stdio. It does not
reimplement bundling. If the Node CLI resolves `emoon-host` and `EMOON_HOST` is
unset, it passes that path; otherwise the native command owns host resolution.

## Verification (2026-10-28, Linux x86_64)

Commands and results:

- `node scripts/build-cli.cjs` → PASS, release-strip CLI **2,537,464 bytes**.
- `node --test tests/emoon-bundle.test.cjs tests/emoon-bundle-ux.test.cjs` →
  **17 PASS / 0 FAIL**.
- `node --test tests/emoon-cli.test.cjs tests/emoon-cli-parity.test.cjs` →
  **30 PASS / 0 FAIL**.
- `moon test --target native` → **203 PASS / 0 FAIL**; `moon test --target js` →
  **167 PASS / 0 FAIL**.
- `dist/emoon bundle _build/Moji` → **0.823 s**, stage reused, output
  `.emoon/dist/moji-1.0.7-linux-x64`, **6,231,768 bytes (5.9 MiB)**.
- `--bundle-info` → app `moji` 1.0.7, 144 files, zlib, host SHA-256 `b307f5...`.
- Hold run with isolated XDG → exit 0, `pageTitle:"Moji v1.0.7"`,
  `profile:"electron-nodeless-adapted-v1"`.

The bundle is 46,576 bytes larger than the 2026-10-27 artifact because the CLI
prefix grew by the same amount; the app/host payload is unchanged
(raw 13,108,339, stored 3,693,792). The single executable remains self-extracting,
not statically linked; system GTK 3 and WebKitGTK 4.1 are required. No RAM or
startup advantage is claimed here.

NOT RUN: macOS bundle execution/signing/notarization, Windows, human dialog UI
of a bundled app, DnD, publication.
