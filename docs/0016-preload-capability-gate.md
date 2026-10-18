# Preload capability gate (EP-13/EP-14 partial)

Status: **gate recorded, not implemented**. The M1 preload realm deliberately
refuses to fake `contextBridge` or `ipcRenderer`; it now reports the first
unsupported API instead of a generic failure.

## Observed Moji preload surface

The pinned Moji preload requires:

- `contextBridge.exposeInMainWorld`
- `ipcRenderer.invoke`
- `ipcRenderer.on`
- `ipcRenderer.removeListener`
- `webUtils.getPathForFile`

Record: `compatibility/apps/moji-v1.0.5/preload-capabilities.json`.
The required-API list is derived from the pinned built preload; the native M1
observation currently stops at `contextBridge.exposeInMainWorld`.

## Native diagnostic

`NativeHost.m` executes the preload in an isolated `WKContentWorld`. Its
restricted `require('electron')` returns recording proxies, never functional
bridges. The preload reports `{preload, detail}` to the native result handler;
the host exposes the bounded detail through `get-preload-status`.

`loadFile` then rejects with:

```text
ELECTRON_MBT_PRELOAD_UNSUPPORTED_API
Preload requested unsupported API: contextBridge.exposeInMainWorld
```

No page-world object is created, no renderer IPC is available and no preload
success is claimed. A caught `require` still marks the preload unsupported.

## Why this is not contextBridge

The unresolved M0 gate is safe synchronous function identity across
WKContentWorlds. A postMessage/async shim does not prove synchronous
`contextBridge` semantics, renderer exception mapping, origin/document
generation or sender authentication. This increment only records the gate.

The test-only B5 spike ([docs/0038](0038-m0-context-bridge-spike.md)) recorded
`go` for a repaired synchronous shared-DOM/HMAC candidate on one macOS/WebKit
build. It does **not** change this gate: production `contextBridge`/
`ipcRenderer`, MoonBit authority/lifetime/bounds, native sender/document
authority and independent review remain unimplemented, the original preload
stays `NOT_EXECUTED`, and M0 remains OPEN.

## Verified

- `transport/protocol_wbtest.mbt`: exact `get-preload-status` ACK validation.
- `tests/context-bridge-preload-native.test.cjs`: actual preload runs in the
  isolated world; unsupported require/caught require/syntax failure remain
  fail-closed; the new Moji-style detail is observed.
- Native smoke/rebuild pass.

## Open

- safe contextBridge function/module identity across WKContentWorlds
- renderer `ipcRenderer` invoke/on/removeListener with sender/origin/generation
  authentication and bounded clone
- `webUtils.getPathForFile` identity and file-path authority
- preload failure taxonomy and reload revocation
- Moji renderer bootstrap and app scenarios
