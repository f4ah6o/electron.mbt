# M1 native host contract and fail-closed launch gate

Status: proposed implementation increment. Parent: `issues/open/0001-electron-compatible-lightweight-runtime.md`.

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
