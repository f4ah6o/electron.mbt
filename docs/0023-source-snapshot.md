# Source snapshot / document identity (fixture)

Status: **fixture-only, EP-15 partial (B1)**. This slice covers the entry
document only. It does not snapshot the whole app graph, sign the source
manifest, connect Main/renderer ingress or claim app compatibility.

## Contract

- [fixtures/native-app/source-manifest.json](fixtures/native-app/source-manifest.json)
  pins the fixture entry by relative path, SHA-256 and byte length.
- [scripts/source-manifest.cjs](scripts/source-manifest.cjs) deterministically
  builds the manifest, rejects absolute/`..` entries, missing files,
  non-regular files, symlink escapes and oversize entries.
- [compatibility/adapted-preload-v1.json](compatibility/adapted-preload-v1.json)
  records the same entry/hash/bytes and `staging: private-temporary-directory`.
- [scripts/adapted-preload-check.cjs](scripts/adapted-preload-check.cjs) rejects
  a manifest or record that no longer matches the working tree.

## Native execution

- `prepare-source` accepts one relative `file` and reads
  `source-manifest.json` from the app root. The manifest must have schema 1, an
  app name, a safe entry, a 64-character lowercase SHA-256 and a bounded byte
  count.
- The requested entry is canonicalized under the app root. Native rejects an
  absolute or `..` request, a path outside the root, a non-regular file, a
  symlink escape and a file larger than 1 MiB.
- Native reads the file once, compares its actual SHA-256 and byte length with
  the manifest, then writes that same byte buffer to a private staging
  directory under `NSTemporaryDirectory()` (directory `0700`, file `0600`).
- The staging root and file are canonicalized before WebKit sees them, so a
  `/var` to `/private/var` alias cannot make the file URL and its read-access
  grant disagree.
- When a snapshot is prepared, `load-file` only accepts the manifest's source
  path and substitutes the staged file. The app root itself is never modified.
  The adapter source is still read from the app root and remains the separately
  pinned generated artifact.
- `get-document-identity` requires a completed current load and a canonical
  page URL equal to `loadedFile`. It returns the current generation,
  `source: "snapshot"`, and the snapshot SHA-256. An unprepared app-root load
  reports `source: "app"` with an empty hash.
- A second `prepare-source` before generation 2 replaces the staged file. The
  previous staging directory is removed, as it is on window teardown and
  WebContent termination.

## Evidence

The native supervisor prepares the fixture entry before load, re-prepares it
before the generation-2 reload, and reports
`sourceSnapshot: true` / `sourceSnapshotReload: true` alongside the adapted
adapter, event and document-start observations.

```json
{"status":"PASS","probe":"m1-source-snapshot","backend":"AppKit+WKWebView","preparedSHA256":"...","documentIdentity":"snapshot","loadedFromSnapshot":true,"hashMismatchRejected":true,"symlinkEscapeRejected":true,"nonRegularRejected":true,"missingManifestRejected":true,"compatible":false}
```

The probe mutates the working-tree entry after `prepare-source` and verifies
that the loaded page still has the prepared title and content and that the URL
is the snapshot file. It also verifies that the staging directory is removed
after shutdown. Negative probes cover a hash mismatch, a symlink escape, a
directory entry and a missing manifest.

## Deliberate limits

- only the entry document is snapshotted; the full app graph, package files and
  the generated adapter are not copied into the snapshot
- the source manifest is an app-root input, not a signature; a writer who can
  change both the file and the manifest is not prevented by this slice
- no manifest provenance, timestamp or transparency log
- no origin/redirect/back-forward/cross-document identity policy
- no native Main/renderer ingress, IPC, sender grant or compatibility claim
- a host crash can leave a private staging directory behind; normal teardown
  and WebContent termination remove it
- `compatible:false`, adapted **partial** and strict **blocked** are unchanged

## Next

- snapshot the complete boot graph and the generated adapter, then record
  manifest provenance separately from the working tree
- connect `get-document-identity` to EP-14 sender admission
- add origin/redirect/back-forward and opaque-origin negative cases
- keep the source snapshot independent from Main/renderer authority
