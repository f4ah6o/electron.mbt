# Issue 0001 implementation ledger

Status: M0 in progress. This document does not replace or close `issues/open/0001-electron-compatible-lightweight-runtime.md`.

## Connected execution paths

1. The CLI obtains filesystem metadata without loading application code, then invokes the compiled MoonBit `diagnose` export. MoonBit always retains the open-M0 diagnostic. `dispatch` delegates lifecycle calls to the same MoonBit core used by deterministic tests.
2. The synchronous transport probe uses a real Node-API addon, a private POSIX socketpair, an inherited child descriptor and a separate Node process. Calls use a single absolute monotonic deadline and never pump the Node event loop. Timeout, EOF, truncated or oversized reply closes the usable channel; late replies cannot be reused by a subsequent call. The peer is a fault-injection fixture, not a native desktop host.
3. The WKWebView probe puts document-start code and its script-message handler in a named non-page `WKContentWorld`. The first page script checks that those globals/handlers are absent and replaces a page primordial. Native code observes the main frame, checks the isolated primordial and verifies that DOM is shared. These are world observations, not an implementation of preload require, contextBridge or native sender capabilities.
4. The Electron fixture captures first-script bridge availability, synchronous return/throw, promises/rejections, frozen data, callback identity/removal and lifecycle traces without changing its sources. The baseline runner records actual observations rather than inventing an electron.mbt comparison. A baseline collection success is not differential compatibility.

## Ownership and unfinished wiring

| Area | Owner now | Remaining production connection |
| --- | --- | --- |
| Lifecycle, logical handles, document generations, grants, request ledger | MoonBit `core` | Native host, OS event acknowledgements and complete Electron event ordering |
| Diagnostic decisions | MoonBit `bridge` | Full API inventory and version-bound compatibility evidence |
| JS object reflection, value rejection and module hooks | Node leaf adapters | Wire to core-owned IPC routing, limits and native-attested document context |
| Synchronous control I/O | C Node-API leaf probe | Typed/negotiated host protocol, correlation, ownership-safe channel wrapper and reentrancy design |
| OS windows and WebView | Standalone Objective-C feasibility probe | MoonBit-native host and gpui/AppKit boundary; no general BrowserWindow implementation yet |
| Electron oracle | Separate test fixture | Same fixture executed on electron.mbt, normalization and acceptance comparison |

Caller-supplied core `host_origin`/`main_frame` arguments are trusted adapter inputs for unit tests, not proof of an authenticated sender. The production adapter must derive them from native frame/document/session state and cannot accept renderer claims. Document grants and pending cancellations do not by themselves secure a disconnected renderer.

## Open milestone gates

1. **M0**: preserve exact Electron source commit, toolchain/core checksums and macOS/SDK/WebView revisions; prove safe synchronous function proxies across isolated worlds, nested/reentrant calls and callback identity; extend unchanged fixtures; choose a real app and collect comparable size/process/cold-warm baselines. The current CI bootstrap downloads the official toolchain installer and checks the observed compiler/build-system versions, but immutable installer/core-distribution checksums remain open. No M0 completion is asserted.
2. **M1**: native MoonBit host, gpui integration, real Node runner, `app`, `BrowserWindow`, private negotiated session transport, native events/reentrancy/cancellation, source-preserving launcher and controlled app-origin resource serving.
3. **M2**: isolated preload loader, synchronous and asynchronous contextBridge, ipcMain/ipcRenderer and listeners, error/clone semantics, dialogs/files/clipboard, sender attestation, navigation revocation, fault injection and all bounded resource ledgers.
4. **M3**: actual Electron application acceptance, pack with fixed Node and production dependencies, signing/SBOM/license notices, no hidden Chromium, full size/startup/memory/process measurements, distribution and security-update responsibilities.
5. **M4**: the remaining platform profiles and APIs in the design, including Windows/Linux backends. ESM, native addons, ASAR and update behavior must receive separate compatibility evidence, not be inferred from CJS probe success.

## Evidence rules

1. `moon check`, `moon test --target js`, `moon test --target native` and the CJS build run in the `moonbit` CI job. Node integration tests require that real compiled output. A generated substitute core is prohibited.
2. `npm test` covers the complete current Node suite; `test:leaf` is intentionally narrower. Tests use `What` names and reject unsupported values instead of accepting degraded representations.
3. macOS probe and Electron baseline outputs are uploaded as CI artifacts. Their actual CPU/OS/SDK/WebKit versions must be read from the artifacts before claiming any supported environment. Headless/hosted observations do not replace interactive IME, accessibility or real-app acceptance.
4. A transport watchdog PASS proves only bounded behavior of the tested call. It does not prove that a complete Node/host/WebView process tree is terminated or that a public Electron API preserves reentrant ordering.
5. No acceptance row is `verified` without immutable environment/fixture/runtime evidence for that entire row. Skipped and NOT_RUN results are never PASS.

## Delegation status

Implementation delegation through the GitHub Codex integration was attempted on PR #1. The bot replied that a repository environment must first be created, so no delegated implementation execution was confirmed. The implementation was written by the coordinating agent. Independent code review is requested on the implementation PR and its actual response belongs in the PR record; an implementation-environment error is not a review result.
