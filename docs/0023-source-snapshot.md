# Source snapshot / document identity (fixture)

Status: **fixture-only, EP-15 partial (B2a)**. This slice covers the entry
document and the generated page adapter. It does not snapshot the complete app
graph, sign the source manifest, connect Main/renderer ingress or claim app
compatibility.

## Contract

- [fixtures/native-app/source-manifest.json](fixtures/native-app/source-manifest.json)
  uses schema 2 and pins two files: the fixture entry and
  `adapted/page-api.js`, each by relative path, SHA-256 and byte length.
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
  symlink escape, a duplicate path and a file larger than 1 MiB.
- Native reads each file once and compares its actual SHA-256 and byte length
  with the manifest. It then writes the same byte buffers to a private staging
  directory under `NSTemporaryDirectory()`, preserving relative paths
  (directory `0700`, files `0600`).
- The staging root is canonicalized before WebKit sees it, so a `/var` to
  `/private/var` alias cannot make the file URL and its read-access grant
  disagree.
- When a snapshot is prepared, `load-file` only accepts a listed source path and
  substitutes its staged file. `install-adapted-adapter` likewise reads the
  staged adapter when the requested adapter path is in the snapshot. An adapter
  request that is not in the manifest is denied. The app root itself is never
  modified.
- `get-document-identity` requires a completed current load and a canonical
  page URL equal to `loadedFile`. It returns the current generation,
  `source: "snapshot"`, the entry SHA-256 and the whole-manifest SHA-256.
- A second `prepare-source` before generation 2 replaces the staged tree. The
  previous staging directory is removed, as it is on window teardown and
  WebContent termination.

## Evidence

The native supervisor prepares the fixture before installing the adapter,
re-prepares before the generation-2 reload, and reports
`sourceSnapshot: true` / `sourceSnapshotReload: true` alongside the adapted
adapter, event and document-start observations.

```json
{"status":"PASS","probe":"m1-source-snapshot","backend":"AppKit+WKWebView","preparedSHA256":"...","manifestSHA256":"...","documentIdentity":"snapshot","preparedAdapter":true,"loadedFromSnapshot":true,"hashMismatchRejected":true,"symlinkEscapeRejected":true,"nonRegularRejected":true,"missingManifestRejected":true,"compatible":false}
```

The probe mutates both the working-tree entry and the working-tree adapter
after `prepare-source`, then installs and loads. The page still reports the
prepared adapter and prepared title, the document identity matches the prepared
entry and manifest hashes, and the staging directory is removed after shutdown.
Negative probes cover a hash mismatch, a symlink escape, a directory entry and
a missing manifest.

## Deliberate limits

- the snapshot covers the entry document and the generated adapter only; the
  remaining boot graph (main-process files, package metadata, styles, assets)
  is not copied into it
- the source manifest is an app-root input, not a signature; a writer who can
  change both the files and the manifest is not prevented by this slice
- no manifest provenance, timestamp or transparency log
- no origin/redirect/back-forward/cross-document identity policy
- no native Main/renderer ingress, IPC, sender grant or compatibility claim
- a host crash can leave a private staging directory behind; normal teardown
  and WebContent termination remove it
- `compatible:false`, adapted **partial** and strict **blocked** are unchanged

## Next

- snapshot the complete boot graph and record manifest provenance separately
  from the working tree
- connect `get-document-identity` to EP-14 sender admission
- add origin/redirect/back-forward and opaque-origin negative cases
- keep the source snapshot independent from Main/renderer authority
