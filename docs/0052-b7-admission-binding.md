# B7 admitted-descriptor page binding

Status: **experimental M1 binding executed; strict profile remains blocked.**
`compatible:false`, M0 OPEN, the original preload NOT_EXECUTED and the strict
profile blocked are unchanged. This note records the 2026-10-20 increment; it is
not a strict-profile admission.

## Problem

The B6-C/B6-D transport already performs a synchronous, HMAC-signed handshake
between the page shim and the isolated bridge. The preview (Node VM) descriptor
was registered with the MoonBit B6-A authority before load, but the page shim
only checked the exposed **key**. A preload that exposes the same key with a
different descriptor in the real WebView could therefore materialize and use an
API that MoonBit never admitted. The native host detected the mismatch and the
Node runtime aborted later, but the page had already materialized the actual
API.

## Change

1. `bridges/preload/isolated-bridge.js` includes the actual descriptor's byte
   length, function count and SHA-256 in the signed `descriptor` handshake.
2. `platform/macos/NativeHost.m` injects the preview descriptor metadata
   (`__m0ExpectedDescriptorBytes`, `__m0ExpectedFunctionCount`,
   `__m0ExpectedDescriptorSHA256`) into the page shim lexically, next to the
   existing secret and key. The native host refuses to install the page shim if
   the admitted metadata is missing or malformed.
3. `bridges/preload/page-shim.js` verifies all three values synchronously in
   `hello()`, before decoding or materializing anything. A mismatch throws
   `ELECTRON_MBT_BRIDGE_ADMISSION_MISMATCH`; the getter caches the error and
   never exposes the actual API.
4. `bridges/node/context-runtime.cjs` keeps the existing pre-registration and
   mismatch abort. `ELECTRON_MBT_B6_ADMISSION_OBSERVE=1` is a **test-only**
   observation mode that records the mismatch and keeps the host alive so the
   native E2E can read the page-side result. The default path still aborts.

The page gate now says: the actual descriptor must be exactly the descriptor
MoonBit registered before load. This is an admitted-descriptor binding, not a
claim that the native host replies before the page.

## Evidence

Command:

```sh
node --test tests/context-bridge-admission-binding-native.test.cjs
```

Observed (macOS 26.5.2 / Node 24.22.0, local not pinned):

```json
{"probe":"b7-descriptor-admission-binding","status":"PASS","previewKey":"fixture","actualKey":"fixture","previewFunctionCount":1,"actualFunctionCount":2,"pageOutcome":"admission:blocked:ELECTRON_MBT_BRIDGE_ADMISSION_MISMATCH","pageMaterialized":false,"hostAborted":false,"observeMode":true,"compatible":false,"contextBridge":"NOT_IMPLEMENTED","productionContextBridge":"NOT_IMPLEMENTED"}
```

The fixture exposes the same `fixture` key in both environments, but one
function in the VM preview and two in the real WebView. The page cannot obtain
the API. MoonBit holds only the preview exposure. The existing B6-C/B6-D,
preload-key, frame and self-DoS tests still pass, and `npm test` is 482 pass.
Raw record: [evidence/b7-admission-binding.json](../evidence/b7-admission-binding.json).

## Why not the hidden-preflight design

The approved Phase 1 plan listed a hidden preflight WebView as the primary
mechanism. The binding achieves the same page-level fail-closed property for
deterministic descriptors without executing the preload twice. Preflight would
still be required to *admit* a non-deterministic actual descriptor, but that
would introduce observable double execution and a new compatibility deviation.
This increment therefore records the narrower decision: deterministic
descriptors are admitted only when they equal the preview; non-deterministic
descriptors fail closed. Preflight remains unbuilt and is not claimed.

## Limits

- Dynamic/non-deterministic preloads fail closed. They are not admitted.
- The host reply is asynchronous. The synchronous gate is the page-shim
  binding; the native expected-descriptor check and Node comparison are
  defence in depth.
- The strict nodeless runtime has not been ported.
- Full preload globals/`ipcRenderer`/`webUtils`, Electron-compatible child
  frames, the full CPU/memory fault matrix and the independent security review
  remain open.
- The Electron oracle differential is NOT RUN locally.
- No strict-profile admission, no `compatible:true`, no A–J row promotion.

## Next

1. Carry the same binding into the strict nodeless runtime (Phase 4/port).
2. Decide whether non-deterministic preloads are in the strict subset. If they
   are, design a preflight path and measure its double-execution effects; if
   they are not, record the explicit restriction.
3. Continue with Phase 2: Node-less document authority and production ingress.
