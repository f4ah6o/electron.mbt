# Experimental M1 native host and CJS runner

Status: **partial M1 implementation; NOT Electron-compatible**. M0's synchronous isolated contextBridge gate remains open. Issues 0001 and 0002 remain open.

## macOS usage

Install the pinned MoonBit toolchain and Node 24.21.0 with matching Node-API headers, plus Xcode CLI tools and a WindowServer. Run these shell commands in order:

1. npm run build
2. node scripts/build-macos-host.cjs
3. node scripts/m1-macos-smoke.cjs
4. node scripts/m1-invalid-wire.cjs
5. node scripts/m1-app-smoke.cjs
6. node scripts/m1-load-event-chain.cjs
7. node scripts/m1-host-init-fault.cjs
8. node scripts/m1-begin-load-failure.cjs
9. node scripts/m1-slow-load.cjs
10. node scripts/m1-load-deadline.cjs
11. node scripts/build-macos-host.cjs --simulate-webkit-termination
12. node scripts/m1-renderer-delegate-sim.cjs
13. node scripts/m1-host-loss.cjs
14. node scripts/build-macos-host.cjs --simulate-native-close
15. node scripts/m1-native-close.cjs
16. node scripts/m1-native-close-race.cjs
17. node cmd/electron-mbt.cjs run fixtures/m1-app --experimental-m1

Ordinary run and pack still fail closed. The explicit --experimental-m1 switch opts into a narrow test profile, **not** compatibility certification. The CJS fixture and dependency both import electron without rewriting app source.

## Actual ownership and native plumbing

1. MoonBit core owns application and window lifecycle, close cancellation, destruction and document generations. MoonBit transport owns the strict parser, bounds, session ledger, replay defense and exactly-once correlation.
2. A Node-API leaf creates private POSIX socketpairs for synchronous control, asynchronous navigation and native events. The native executable receives inherited child descriptors, an ephemeral session value and a canonical app root. Frames are length-prefixed (max 1 MiB) with a monotonic watchdog measured from queue insertion (including time before the shared Worker can dispatch a load). Every async request also has a Node-side absolute deadline, and the Worker checks the remaining monotonic time before entering native I/O. Timeout poisons the whole native session rather than allowing queued responses to leak across requests. There is no public TCP listener or renderer message handler.
3. AppKit/WKWebView run on the native main thread. Native I/O workers queue UI actions; a Node worker thread waits for WK navigation responses without blocking the Node main event loop. A separate bounded socket streams both native WebKit termination and AppKit window close-request events into the MoonBit session verifier. The host acknowledges create, show, close, destroy and shutdown; load-file completes on WKWebView didFinishNavigation rather than first paint.
4. WKWebView has a nonpersistent data store and no preload, Node globals or generic evaluate-script API. The host independently canonicalizes paths, restricts file access to the app root and denies external or alternate main-frame navigation.
5. Correlation error, timeout or EOF poisons the channel. Native operation errors are separately typed. On abort, the Node-API shutdown operation wakes the blocked native load fd without releasing it; close is deferred until the Worker exits to prevent FD reuse. The native child, event socket, all acquired descriptor pairs and Worker are released even if partial initialization fails. Failed or non-executable child launches reject before ready; unexpected post-ready child death emits a runtime-host-gone event and revokes the runtime instead of forging window close events. After normal shutdown, the host exits; SIGTERM then a bounded SIGKILL fallback handle a stuck child.

## Limited exposed facade

App: whenReady, isReady, ready event, quit, getName, getVersion and getAppPath.

BrowserWindow: synchronous construction after ready; width, height, title, show and explicitly safe webPreferences only; loadFile, show, close (cancelable), destroy, isDestroyed, getAllWindows and webContents did-finish-load event. Each load reserves its generation synchronously; a concurrent loadFile is explicitly rejected until the current load settles. The renderer is not allowed to initiate a new main-frame navigation or same-file reload. Native WebKit termination emits an experimental runtime-web-content-gone signal and invalidates document grants through MoonBit. Terminal native load events clear the per-window loading guard before emitting callbacks, enabling a new load from did-finish-load or a retry from did-fail-load; a listener's own exception is not reclassified as a native load failure. The native NSWindow close button is enabled. The AppKit delegate defers an OS close gesture, emits a bounded native-close-request, and accepts the result only after Node's synchronous cancellable close event and a native ACK. A cancelled request explicitly unlocks the button for the next gesture. Its native ACK carries the exact monotonic event ID; Node records a per-window cancellation watermark and ignores already cancelled notifications that arrive from the native event queue after the application cancelled the gesture. The window constructor only returns after a real native WKWebView has been created.

Explicitly unsupported: preload, contextBridge, ipcMain, ipcRenderer, nodeIntegration:true, sandbox:false, contextIsolation:false, webSecurity:false, ESM Electron imports, native addons, ASAR, unlisted options, getBounds, webContents.send, DevTools and all other Electron APIs. A test-only macOS host uses performClose twice to verify native close cancellation and retry; human physical pointer/keyboard acceptance and exact Electron native event ordering are not yet verified.

## Unfinished acceptance and security

- Short control operations still block Node synchronously, but the Promise-returning loadFile operation uses a separate worker/channel. CI verifies Node timers stay responsive during deliberately slow WebKit documents, four queued requests enforce a common start-of-queue deadline, and abort interrupts a Worker stuck in a 10-second native poll without holding the fd open indefinitely. The Worker is still a serialized load lane, and arbitrary Electron reentrancy/event ordering and true multi-navigation cancellation remain unverified.
- CI proves real WKWebView and an unchanged CJS fixture, but not a real third-party app or the same complete Electron oracle. WKContentWorld observations do not demonstrate a synchronous cross-realm function proxy.
- Renderer-to-host IPC does not exist. A random session value over a private inherited socket is not OS-level sender/frame/document attestation. Main remains a trusted Node process.
- Main-frame navigation checks and document revocation are implemented; native frames with fractional/rounded identifiers are rejected before dispatch. CI exercises a **simulated public WKWebView termination delegate callback**, but not an actual WebKit renderer kill. Remote subresource traffic, storage origin, popup handling, IME/focus/accessibility, process isolation and permission equivalence have not been fully audited or accepted.
- gpui.mbt integration, signing, distribution, real app acceptance, process-tree fault accounting, cold/warm size/performance measurement, and Windows/Linux backends remain open.

The macOS CI also runs regression tests for early native-generation failure, reentrant load completion/failure callbacks, third socketpair acquisition failure, Worker constructor failure after native child spawn, non-executable host, unexpected host process death, child PID/FD recovery, queue-wide timeouts, AppKit native close cancel/retry, and a programmatic cancellation preceding a delayed native close notification. These are narrow targeted assertions, not generalized process-tree safety evidence.

Never treat the CI smoke, old Electron baseline or successful compilation as a verified A-J compatibility row. Preserve test evidence and exact pinned environment versions.
