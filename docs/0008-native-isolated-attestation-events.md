# Native one-shot isolated preload attestation event

Status: **internal prerequisite only**, stacked on Draft PR #10 at `d46f55d8d5100f16aa37d0901d6f4cc2fad565c3`.
This increment does not add Electron `ipcRenderer` or contextBridge and cannot
authenticate arbitrary page-originated messages. No main or other PR branch update.

## Concrete behavior

After receiving a genuine `WKScriptMessage` from its own main-frame isolated
`WKContentWorld`, the AppKit host already verifies exact WKWebView/controller,
file URL, navigation generation and a private per-navigation nonce. It now
publishes a one-shot `isolated-preload-attested` event **only after a completed
successful navigation and successful restricted preload execution** (or the
host-owned bootstrap when no preload was configured). It never includes a
user channel, nonce, origin claim or arbitrary renderer payload. A failed
preload, failed navigation, stale or duplicate bootstrap cannot publish.

The event uses the existing private native-to-Node event descriptor and
ordered serial notification queue rather than a page-readable DOM transport.
The MoonBit protocol parser authorizes the operation with an exactly-empty
payload and strictly-positive document generation, and its session ledger
enforces monotonic event IDs and rejects terminal/replayed events. The Node
`NativeHost` emits the event only after the compiled protocol gate accepts
it. Its fields are `{request, window, generation}` from the trusted native
host; they are **not** page-provided sender metadata.

This notification can arrive before the asynchronous `loadFile` reply because
native event and load acknowledgements use separate descriptors. Consumers must
not treat the notification alone as application readiness: wait for a
successful `loadFile` and verify `get-bootstrap-status` for the same
window/generation before granting host-side authority. Runtime/candidate
renderer IPC binding is **not** implemented by this increment.

## Verification

- `moon check --target js`, `moon test --target js/native`, `npm test` on
  pinned Linux toolchain/Node, and complete `npm test` on Apple Silicon macOS.
- `tests/host-protocol.test.cjs`: one-shot monotonic native attestation,
  payload/terminal/window/generation/session negatives.
- `tests/context-bridge-bootstrap-native.test.cjs`: actual WKWebView
  main-frame bootstrap emits once per generation, including same-file reload.
- `tests/context-bridge-preload-native.test.cjs`: actual file-backed CJS emits
  on success and never emits for unsupported, caught unsupported or broken CJS.
- Inherited host/close/termination/oracle/security regressions remain active.
- No claims of physical keyboard/IME/a11y, originator attestation of page
  requests, authenticated `ipcRenderer`, frozen cross-world bridge values or
  strict Electron compatibility are made.

`compatible:false`, `contextBridge:NOT_IMPLEMENTED`, M0 OPEN, normal
`run`/`pack` fail-closed.
