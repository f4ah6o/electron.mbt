# Manual trial: the `emoon` demo window

Status: **developer convenience on Linux; `compatible:false`.** This is an
interactive trial, not a compatibility result.

## One command

```sh
npm run demo:emoon
# equivalent: node scripts/try-emoon.cjs
```

The script:

1. builds `dist/emoon` and `dist/emoon-host` if they are missing (or when
   `--rebuild` is passed);
2. copies [`fixtures/manual-demo-app`](../fixtures/manual-demo-app/) to
   `_build/manual-demo` (unless it already exists);
3. runs native `init`, `inspect`, `migrate` and `doctor`;
4. opens a real GTK/WebKitGTK window with
   `run <stage> --window --hold --entry out/main/index.js`.

The window stays open until you close it. The CLI prints `HOLDING` and, after
the close, `HOLD_EXIT` with `reason:"window-closed"`.

Options:

| option | meaning |
| --- | --- |
| `--no-launch` | stop after doctor and print the `run --hold` command |
| `--reset` | delete `_build/manual-demo` and copy the fixture again |
| `--rebuild` | rebuild `dist/emoon` and `dist/emoon-host` first |

## What to try

- Read the JSON reports: the tier is `adapted`, the stage is `.emoon/app`, and
  the manifest/adapter hashes are printed. Every report stays
  `compatible:false`.
- In the window, click **getSettings** and **ping**. The page log shows the
  replies from `ipcMain.handle` in `out/main/index.js`; the initial call runs
  on load.
- Inspect `_build/manual-demo/.emoon/` and the staged source. The demo source is
  copied below `_build/`; the fixture source is not modified.
- Edit `_build/manual-demo/out/renderer/index.html` or `app.js`, then rerun
  `node scripts/try-emoon.cjs` (the existing copy is kept). Use `--reset` to
  restore the fixture copy.

## Trying Moji 1.0.5 from the prepared stage

A prepared Moji stage is kept under the gitignored `_build/moji-linux-app`. It
contains the 1.0.5 build, `source-manifest.json`, the adapted page API and
`.appData`/`.userData`:

```sh
dist/emoon doctor _build/moji-linux-app
dist/emoon run _build/moji-linux-app --window --hold --entry out/main/main.js
```

The window title is `Moji v1.0.5`. Close it with the window manager; the CLI then
prints `HOLD_EXIT reason:"window-closed"` and exits 0. This is the adapted
profile (`compatible:false`); the original preload is not executed.

## Why `dev ./_build/Moji` fails

`_build/Moji` is a 1.0.7 **source checkout**, not a built app: it has neither
`out/` nor `node_modules/`. `emoon dev` stages an already-built app and does not
run TypeScript/Vite builds by default. The preflight now reports:

```json
{"ok":false,"compatible":false,"code":"ELECTRON_MBT_MIGRATE_BUILD_MISSING","message":"package.json main \"out/main/main.js\" does not exist; build the app first (npm run build) or pass emoon dev --build"}
```

After installing dependencies, either build manually or let the explicit
`--build` flag run the app's own `build` script:

```sh
cd _build/Moji
npm install
npm run build
cd ../..
dist/emoon dev _build/Moji --no-launch

# or, after npm install:
dist/emoon dev _build/Moji --build --no-launch
```

`--build` never runs `npm install`; missing `node_modules` is
`ELECTRON_MBT_MIGRATE_BUILD_DEPS`, and a missing/failing build script is
`ELECTRON_MBT_MIGRATE_BUILD`. The 1.0.7 build above is **NOT RUN** in this
increment; the 1.0.5 prepared stage is the verified Moji path.

## Using your own app

```sh
# stage and stop before launching
dist/emoon dev /path/to/app --no-launch

# show the staged app and keep the window open for inspection
dist/emoon run /path/to/app/.emoon/app --window --hold \
  --entry <package.json main>
```

This is a prepared CommonJS app stage; it is not a general Electron runner. See
[the CLI contract](0062-cli-contract.md) and
[the migration note](0061-migrating-from-electron.md).

## Page-script caveat

The generated adapter defines the exposed name (`api` in the demo) as a
**non-configurable** `window` property. A classic renderer script that declares
`const api = window.api` at top level conflicts with that property and fails in
JavaScriptCore with `SyntaxError: Can't create dup`; the script does not run.
Read `window.api` directly or wrap the script in an IIFE, as the demo's `app.js`
does. This mirrors the non-configurable exposure and is not an Electron
compatibility claim.

The demo uses the adapted page API (`getSettings`, `ping`) generated from
`adapted-preload.json`; it does not execute the original preload.

## Limits

- Linux GTK3/WebKitGTK 4.1 in this environment. macOS native execution and
  Windows are NOT RUN.
- `--hold` is an interactive developer mode. It does not prove renderer,
  preload, contextBridge, human dialog or product compatibility.
- `moon publish`, GitHub Releases, `moon binstall` and `npm publish` remain NOT
  RUN.
