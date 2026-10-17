# Source snapshot / document identity (fixture)

Status: **fixture-only, EP-15 partial (B2a + B2b)**. The snapshot now covers the
fixture entry, the generated adapter, `package.json`, the `src` module graph and
the `fixture-pkg` node_modules fixture. It is still a fixture graph, not a
general app loader or a signed application build.

## Contract

- [fixtures/native-app/source-manifest.json](fixtures/native-app/source-manifest.json)
  uses schema 2 and pins 11 files: the page entry, the generated adapter,
  `package.json`, `src/main.js`, the `src/lib` modules/JSON, and the
  `node_modules/fixture-pkg` files.
- [scripts/source-manifest.cjs](scripts/source-manifest.cjs) deterministically
  builds the manifest, puts the entry first, and rejects absolute/`..` paths,
  missing/non-regular files, symlink escapes, duplicates, an entry not listed
  and oversize files.
- [compatibility/adapted-preload-v1.json](compatibility/adapted-preload-v1.json)
  records the same file table and `staging: private-temporary-directory`.
- [scripts/adapted-preload-check.cjs](scripts/adapted-preload-check.cjs) rejects
  a manifest or record that no longer matches the working tree.

## Native execution

- `prepare-source` accepts one relative `file` and reads
  `source-manifest.json` from the app root. The manifest must have schema 2, an
  app name, a safe entry and a bounded `files` array; the requested file must
  equal the manifest entry.
- Every listed file is canonicalized under the app root. Native rejects an
  absolute or `..` request, a path outside the root, a non-regular file, a
  symlink escape, a duplicate path and a file larger than 16 MiB; the whole graph is bounded to 64 MiB and 4096 files.
- Native reads each file once and compares its actual SHA-256 and byte length
  with the manifest. It then writes the same byte buffers to a private staging
  directory under `NSTemporaryDirectory()`, preserving relative paths
  (directory `0700`, files `0600`).
- The staging root is canonicalized before WebKit sees it, so a `/var` to
  `/private/var` alias cannot make the file URL and its read-access grant
  disagree.
- When a snapshot is prepared, `load-file` only accepts a listed source path and
  substitutes its staged file. `install-adapted-adapter` likewise reads the
  staged adapter. The supervisor evaluates the QuickJS Main from the staged
  root; the app root itself is never modified.
- `get-document-identity` requires a completed current load and a canonical
  page URL equal to `loadedFile`. It returns the current generation,
  `source: "snapshot"`, the entry SHA-256 and the whole-manifest SHA-256.
- A second `prepare-source` before generation 2 replaces the staged tree. The
  previous staging directory is removed, as it is on window teardown and
  WebContent termination.

## Evidence

The native supervisor prepares the full fixture before creating the window
title/Main and installs the adapter from the snapshot. It reports
`sourceSnapshot: true` / `sourceSnapshotReload: true` and `appEntry:
"src/main.js"` from the staged Main graph.

The source-snapshot probe additionally stages a `src/main.js` file, mutates the
working-tree entry/adapter/Main copy after prepare, and verifies that the staged
copies remain the prepared bytes. Hash mismatch, symlink, non-regular and
missing-manifest cases remain covered, and the staging directory is removed
after shutdown.

## Deliberate limits

- the manifest is a **preloaded file list**; dynamic `require` of files outside
  the list, ESM and arbitrary package resolution are not general yet
- the raised asset bounds (16 MiB/file, 64 MiB total, 4096 files) exist for the
  Moji renderer graph; they are not a general unlimited asset policy
- the Main loader supports the fixture's relative/package/JSON graph and a
  bounded `node:path` subset only; other Node builtins fail closed
- the source manifest is an app-root input, not a signature; a writer who can
  change both the files and the manifest is not prevented by this slice
- no manifest provenance, timestamp or transparency log
- no origin/redirect/back-forward/cross-document identity policy
- no Moji main/preload, no app compatibility and no verified row
- a host crash can leave a private staging directory behind; normal teardown
  and WebContent termination remove it
- `compatible:false`, adapted **partial** and strict **blocked** are unchanged

## Next

- make the Main loader truly dynamic over a verified graph and add the Node
  symbol layers (EP-11/12)
- record manifest provenance separately from the working tree
- connect document identity to EP-14 sender admission and origin policy
- adapt Moji's main/preload and run an app scenario
