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

The experimental CJS app.quit lifecycle now uses cancellable native-backed window close operations, honors before-quit and will-quit cancellation, suppresses window-all-closed during quit, and restores MoonBit Ready after cancellation. Portable MoonBit-backed Node tests and the real macOS CJS fixture cover these transitions, including `(event, exitCode=0)` on the terminal quit event; fail-closed injected native host loss prevents `will-quit`/`quit` after interrupted close. Renderer beforeunload/unload remains unsupported.

**Still open:** complete E2E of OS focus/IME/accessibility and multi-display, sender attestation and renderer permissions, cross-world synchronous `contextBridge`, production gpui integration, true third-party app differential, packing/signing and Windows/Linux. Keep Draft and no general `run` enablement until the relevant gates are independently verified.

## Additional experimental main-process read surface

`webContents.getURL()` synchronously obtains the actual WKWebView URL over the short private native control lane. The MoonBit transport accepts only empty requests and a single bounded string success payload. Native generation mismatch, destroyed windows and terminated WebKit content remain denied; the URL is not cached in Node. The macOS lifecycle and unchanged CommonJS fixture now exercise before-load, after-load and stale/destroyed behavior. This is not a renderer IPC channel or proof of Electron navigation compatibility.

## Experimental page title read

The experimental CommonJS `webContents.getTitle()` synchronously reads WKWebView's document `title` (distinct from NSWindow `title`). The bounded MoonBit `get-web-contents-title` wire contract requires an empty request and a sole string title field on successful replies (max 4096 UTF-16 code units). The macOS native host validates live WebKit state before replying. Portable tests and actual AppKit/WKWebView CI cover initial empty title, HTML title after navigation, stale-generation and destroyed-window denial, malformed acknowledgements and window-title independence. This adds no renderer privilege or synchronous cross-world `contextBridge`; full Electron compatibility remains open.

## Experimental real NSWindow frame read

The limited `BrowserWindow.getBounds()` retrieves native `NSWindow.frame` over the synchronous private control channel. AppKit coordinates are converted from the primary screen's bottom-left origin into a top-left-origin outer rectangle. MoonBit validates a precisely shaped `{x,y,width,height}` ACK with bounded exact integer coordinates and positive dimensions before consuming pending correlation. JS does not echo requested constructor width/height or maintain a geometry cache. Deterministic Node negatives and actual macOS WKWebView + unchanged CommonJS smoke cover constructor size, hidden/visible invariance, generation mismatch and after-destruction denial. This is an experimental read-only profile: multi-display parity, focus/resize events, `setBounds`, physical input and complete Electron geometry semantics are not yet accepted.

## Experimental partial window-frame updates

The opt-in M1 `BrowserWindow.setBounds()` accepts a deliberately constrained `Partial<Rectangle>` with integer `x/y` in [-1048576,1048576] and optional `width/height` in [100,4096]; `animate:true` is not implemented. The Node facade checks own plain data members and rejects invalid properties, proxies, accessors and unsupported animation before native I/O. The `set-window-bounds` request is registered through MoonBit with exact partial-field validation; success replies must contain four bounded integral frame coordinates before correlation is discharged. AppKit applies the partial update using the current NSWindow frame and a stable primary-display top-left coordinate conversion, then returns actual observed geometry rather than replaying requested values. Unit tests and real macOS / unchanged CJS smoke exercise partial updates, restoration, invalid input isolation, stale generation and destroyed-window denial. Real human-driven resize/move, macOS menu-bar clamping, multiple-display mapping and Electron event parity remain open. This is not a general compatibility verdict.

## Test-triggered real WebKit content-process termination

The dedicated macOS CI executable from `node scripts/build-macos-host.cjs --kill-real-webkit-process` uses WebKit's private `_webProcessIdentifier` and `_killWebContentProcess` selectors **only in a compile-time test build**. It records a real, separate WebContent PID, requests termination after the first successful WKWebView navigation and deliberately does **not** invoke the delegate directly. The public `webViewWebContentProcessDidTerminate:` delegate must emit the native private event, which the MoonBit event ledger observes before the experimental Node runtime marks the old document unusable. `scripts/m1-webkit-process-kill.cjs` checks exactly-one delivery, `show()`/new `loadFile()`/URL/title denial, absence of total native host death, successful creation/loading of a new window and source hash preservation. The existing simulated delegate regression remains separate.

This is a deliberately triggered genuine WebKit subprocess termination, **not** production use of SPI or acceptance of spontaneous/OS-signal crashes, process-tree/GPU cleanup, all WebKit versions, sender attestation, synchronous isolated `contextBridge` or Electron compatibility. Keep M1 experimental and PR Draft.
