# Restricted isolated CommonJS preload: document-start only

Status: **partial, experimental M1**. This extends the native bootstrap in
Draft PR #10, stacked on PR #2. Electron's normal run and pack remain
fail-closed. M0 OPEN, compatible:false, and contextBridge:NOT_IMPLEMENTED
remain unchanged.

## New behavior

The experimental M1 runner accepts BrowserWindow webPreferences.preload
as an *absolute* path to a non-empty .cjs or .js regular file inside the
application root. The Node filesystem leaf canonicalizes the path, rejects
escaping symlinks, requires valid UTF-8, limits source to 65,536 bytes and
hashes the actual bytes with SHA-256. The private control channel carries
the source and digest to native; native verifies UTF-8 byte length and
recomputes the digest before creating the window. Original source is not
rewritten. No external package or app directory may be loaded by preload.

The native WKWebView host injects the source in a named isolated
WKContentWorld using WKUserScriptInjectionTimeAtDocumentStart, restricted
to the main frame. A limited CommonJS module.exports/exports wrapper runs
the body synchronously through Function *in the isolated realm*.
This is not a Node VM, full Electron preload sandbox or CJS module resolver.

Every require() throws an explicit unsupported-module exception. An
attempt permanently marks this preload run unsupported even if the CJS body
catches that exception and otherwise returns normally; it cannot be counted
as a successful execution. In particular, require('electron') and
contextBridge remain unsupported.
No renderer IPC, native file access, Node API or pageWorld privilege is
exposed. A synchronous preload error (including a syntax error) rejects
loadFile with ELECTRON_MBT_PRELOAD_FAILED. An unsupported module import
rejects with ELECTRON_MBT_PRELOAD_UNSUPPORTED_API. Missing verified
bootstrap evidence fails closed as ELECTRON_MBT_PRELOAD_NOT_VERIFIED.
A normal WebKit navigation success cannot override preload failure.

The preload wrapper sends only an enumerated status
(ok/unsupported/failed) and the existing per-navigation nonce to the
isolated native message handler. Native validates actual main-frame,
file URL, WKWebView/controller, expected generation and current nonce.
Completion waits for both WKNavigation success and authenticated preload
status, without blocking the AppKit main thread; a bounded timer rejects
if the status never arrives. Same-URL reload rotates the nonce and
re-runs unchanged source. Termination/close/destroy revoke state and
JS handles. The four-field private bootstrap status remains unchanged.

## Scope / security boundaries

This is a *restricted and deliberately non-compatible preload execution
profile* used to validate source integrity, document-start ordering,
realm isolation and error propagation. It does NOT implement
contextBridge.exposeInMainWorld, secure synchronous page/preload proxy,
copy/freeze, callback identity, or Electron Promise semantics.

The Electron sandboxed preload's process/global polyfills, frame-specific
behavior, and additional supported requires are not implemented. Real
preload code using those APIs is not compatible and must not be silently
rewritten. A document's shared DOM remains an untrusted channel. The M0
shared-DOM spoof and indirect child-origin negatives still block strict
contextBridge compatibility. This restricted preload wrapper should
not be presented as a complete security sandbox for untrusted scripts.

## Verification

- Node tests/preload-file.test.cjs: actual filesystem, path root and
  symlink escapes, UTF-8, zero/maximum/oversized input, stable SHA-256.
- macOS tests/context-bridge-preload-native.test.cjs: real AppKit/WKWebView
  loads the original preload-file bytes, tests first page-world script
  cannot read isolated globals, verifies native trusted bootstrap, same
  URL reload/promise revocation, explicit require('electron') denial,
  syntax error denial and preserved application source hashes.
  Linux skips this macOS-only test (NOT RUN).
- Original full Node/MoonBit suite, macOS M1 native lifecycle checks, M0
  adversarial world probe and pinned Electron oracle remain in CI.
  An Oracle PASS does not certify this restricted candidate.

No general runtime enablement, manifest row promotion, or merge to main
is authorized by this increment.
