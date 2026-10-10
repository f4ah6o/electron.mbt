# M1 native host contract and fail-closed launch gate

Status: **partial experimental M1 implemented on Draft PR #2**; real macOS host and optional CommonJS runner verified by CI, complete Electron compatibility remains unverified. Parent: `issues/open/0001-electron-compatible-lightweight-runtime.md`.

## Goal

Connect the existing MoonBit lifecycle/request ledger to a real macOS native host and Node runner without falsely claiming Electron compatibility. The first deliverable is a real native-window lifecycle and a negotiated, bounded control channel. Do not attempt a page-world preload shortcut to solve synchronous contextBridge.

## Implementation sequence

1. Define a versioned native host envelope with request ID, window ID, document generation, operation, bounded payload and exactly-once terminal result. Reject malformed, oversized, stale, unknown-version and unauthenticated requests before dispatch.
2. Add a MoonBit-owned host session with a finite state machine for spawn, handshake, ready, close, crash and shutdown. Ensure all pending requests are cancelled on session loss; no reuse after timeout.
3. Implement the macOS AppKit/WKWebView adapter as a real native executable with main-thread ownership and explicit window create/show/load/close/destroy acknowledgements. Keep the WKContentWorld feasibility probe separate from the runtime.
4. Add a thin Node CJS facade for `app.whenReady`, `app.isReady` and `BrowserWindow` lifecycle calls, backed by the native session; preserve synchronous return/throw behavior where the actual transport proves it. Fail explicitly for unimplemented API and options.
5. Add `electron-mbt run <app-dir>` only after a real app launch path works. Validate app root and dependency resolution without source rewriting. Keep `pack` unsupported.
6. Add macOS integration and fault tests for process exit, native window teardown, reentrant/timeout behavior, navigation generation, sender spoofing and orphan processes. Keep compatibility manifest rows partial until differential evidence exists.

## Acceptance tests (What)

- Native host creates and destroys a real WKWebView window and returns truthful lifecycle acknowledgements.
- A malformed or unauthenticated envelope never reaches MoonBit dispatch.
- Timeout/EOF/crash produces one terminal error and cannot poison the next request.
- Navigation invalidates stale document grants and callbacks; spoofed origin/frame claims are rejected.
- Existing MoonBit JS/native and Node suites remain passing.
- A pinned macOS CI run records actual OS, SDK, WebKit, Node and MoonBit versions and uploads raw logs.
- `run` is only advertised when the real implementation exists; `contextBridge`, preload, IPC and cross-platform compatibility remain explicitly unsupported until separately proven.

## Non-goals

M2 synchronous isolated contextBridge, production IPC, file dialogs, signed packaging, size savings, Windows/Linux backends, native addon ABI, ASAR and real-app acceptance. Do not disable context isolation, downgrade sandboxing or ship a fake compatibility result.

## Review

Request an independent code review after implementation. Resolve P1/P2 findings and confirm CI before considering merge. This PR is a draft until then.

## Current partial implementation (2026-10-10)

The real AppKit/WKWebView host is connected to a MoonBit-owned versioned session ledger and a restricted CommonJS facade. The experimental opt-in runner can create/show/load/destroy windows; a native NSWindow close request is now forwarded to Node so the cancellable `close` event decides whether AppKit is allowed to proceed. The test-only host invokes `performClose` twice: cancellation followed by an acknowledged close. Source rewriting is not required for the fixture or dependency.

CI [#38050130860](https://github.com/f4ah6o/electron.mbt/actions/runs/38050130860) passed both Linux and macOS jobs, including the native close delegate test, a deliberately delayed close notification ignored after an exact cancellation-token ACK, subprocess launch failure and existing MoonBit/Node contracts. This is not human UI acceptance or proof of the full Electron lifecycle.

The experimental CJS app.quit lifecycle now uses cancellable native-backed window close operations, honors before-quit and will-quit cancellation, suppresses window-all-closed during quit, and restores MoonBit Ready after cancellation. Portable MoonBit-backed Node tests and the real macOS CJS fixture cover these transitions; renderer beforeunload/unload remains unsupported.

**Still open:** complete E2E of OS focus/IME/accessibility and multi-display, sender attestation and renderer permissions, cross-world synchronous `contextBridge`, production gpui integration, true third-party app differential, packing/signing and Windows/Linux. Keep Draft and no general `run` enablement until the relevant gates are independently verified.
