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

The facade now implements `setName/getName/name/isPackaged/getLocale/getPath/setPath`
over an isolated appData/userData root and fails typed for unknown app methods.
Moji reached app-path setup (`appData/moji` was created under the isolated root)
and then stopped at:

```text
exit 1
ELECTRON_MBT_UNSUPPORTED_API
app.requestSingleInstanceLock is not available in the experimental M1 profile
```

This is a real M1 facade boot blocker, not a Node-less boot and not app
acceptance. It did not reach a window or app scenario.

## Open

- typed unsupported-API diagnostics for app methods, instead of a plain TypeError
- isolated `appData`/`userData` root, `setName`/`getPath`/`setPath` with the
  existing-directory policy, and a disposable user
- the next Moji boot blockers after app paths (`requestSingleInstanceLock`,
  `getLocale`, BrowserWindow options, menus/preload, IPC)
- Node-less runner boot with the QuickJS/CJS stack, not the Node-backed M1 host
- signed artifact, SBOM, clean-install and app scenarios
