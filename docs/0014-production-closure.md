# Production dependency closure (EP-05/EP-24 partial)

Status: **partial**. A deterministic lock-driven pruner and production closures
for the pinned Moji/jmd builds are recorded. The M1 boot attempt is a **FAIL**
at the facade boundary; no Node-less boot, app scenario or release claim follows.

## Pruner contract

`scripts/app-prune.cjs` takes a checked-out app plus `package-lock.json`
lockfileVersion 3 and writes a separate directory containing:

- app source/build outputs (excluding `.git`, `node_modules`, `.cache`, `coverage`)
- lock entries that are not `dev:true` and not `link`
- nested `node_modules` entries at their lock paths
- `closure.json` with app/package hashes, package counts, optional-missing
  entries, excluded dev count and native-addon paths

It rejects source symlinks, non-regular files, a non-empty output directory,
output/source overlap, missing non-optional production packages and unsupported
lock versions. It does not execute install scripts, sign, or claim byte-for-byte
reproducibility.

## Recorded closures

| App | production packages | package files | native addons | app files |
| --- | --- | --- | --- | --- |
| Moji v1.0.5 | 174 | 7,165 | 0 | 295 |
| jmd v0.2.3 | 88 | 4,298 | 0 | 227 |

The per-app records are in
`compatibility/apps/*/production-closure.json`. `node_modules` contents are not
committed; only hashes/counts and package identities are retained.

## M1 boot attempt (failed, diagnostic only)

With an isolated app-path root, `HOME` and `TMPDIR`, the production Moji
closure was launched as:

```sh
ELECTRON_MBT_M1_USER_DATA_ROOT=<isolated-root> \
  node cmd/electron-mbt.cjs run <moji-production-closure> --experimental-m1
```

The facade implements `setName/getName/name/isPackaged/getLocale/getPath/setPath`
over an isolated appData/userData root, a real single-instance lock file, typed
unknown-app-property rejection, the main-local `ipcMain` registration surface,
a bounded main-local `Menu` template model, and bounded BrowserWindow options
(position, minimum size, background colour, icon path admission). Moji passed
app paths, single-instance, handler registration and Menu construction, created
its BrowserWindow, applied the options, and then stopped during `loadFile`:

```text
exit 1
ELECTRON_MBT_PRELOAD_UNSUPPORTED_API
Preload requested unsupported API: contextBridge.exposeInMainWorld
```

The native preload realm now records the first unsupported API rather than
returning a generic failure. It deliberately exposes no fake contextBridge or
ipcRenderer. The Menu model does not install an NSMenu; `icon`/`autoHideMenuBar`
are accepted but not applied. This is a real M1 facade boot blocker, not a
Node-less boot and not app acceptance. It did not reach a shown window or app
scenario.

## Open

- native NSMenu/role/click identity; the current Menu is a main-local model only
- icon/window identity and `autoHideMenuBar`; both are accepted but not applied
- preload `contextBridge`/`ipcRenderer` integration and renderer ingress
- the next Moji boot blockers after preload (renderer bootstrap, file dialogs,
  shell/navigation, menus)
- a disposable OS user for real app tests; the current isolated root is not a
  sandbox
- Node-less runner boot with the QuickJS/CJS stack, not the Node-backed M1 host
- signed artifact, SBOM, clean-install and app scenarios
