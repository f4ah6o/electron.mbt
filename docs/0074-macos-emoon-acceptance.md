# Apple Silicon native CLI acceptance

This lane builds the release/strip native `emoon` and the AppKit/WKWebView host,
then checks `version`, static `doctor`, `dev` staging and launch, `run` with the
adapted Node-less fixture, and fixture and Moji 1.0.7 single-file bundles. A
`doctor` result is static admission only. The window tests check the loaded
renderer, adapted requests and replies, host shutdown, and `compatible:false`.
The fixtures set `show:false`; a successful test does not establish human UI
interaction. The bundle checks metadata and executes the output with no adjacent
host, in a temporary home. The test canonicalizes the temporary directory because
the bundle directory creator rejects symlink components (including macOS
`/var`). The same restriction applies to user-supplied `XDG_DATA_HOME`,
`XDG_CACHE_HOME`, and the `$HOME` fallback; use absolute canonical paths without
symlink components if bundle launch reports `ELECTRON_MBT_BUNDLE_HOME` or
`ELECTRON_MBT_BUNDLE_HOST`. Distribution signing and notarization are not tested.

CI checks out Moji at `b9753c0f7d3fe41d975a1231517f4f124b0a4408` (v1.0.7),
installs its locked dependencies with install scripts disabled and builds it.
Its captured adapted preload is a test-time translation; the original preload
is not executed. Logs, command arguments, stdout, stderr, exit codes, signal,
source revision and binary hashes are uploaded in `macos-evidence`, including
on failure. A missing optional local Moji input is reported as NOT RUN; CI
supplies the input and treats a missing or broken input as failure.

Run on Apple Silicon macOS with a WindowServer, Xcode tools, Node and MoonBit:

```sh
node scripts/build-cli.cjs
EMOON_MOJI_ROOT=/absolute/path/to/built-moji-1.0.7 \
  node --test scripts/emoon-macos-acceptance.cjs
```

The test writes `.emoon` and `adapted-preload.json` inside the supplied Moji
checkout; use an isolated copy. It does not establish Electron compatibility,
strict contextBridge support, real user file or dialog workflows, release
readiness, or a signed/notarized bundle. See the CI artifact for the actual
revision-specific results; adding this lane does not itself turn NOT RUN into
PASS.
