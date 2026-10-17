# MoonBit-native supervisor handshake (EP-10 prototype)

Status: **prototype PASS for private handshake, a real window/file load, one
event notice, and a file-loaded linked-QuickJS fixture app main with a local
CJS module graph whose title is applied to the native window**.
This is the first MoonBit-native process that spawns, creates a window in and
loads a file through the real AppKit/WKWebView host without Node. It is not a
complete supervisor, app launcher or Node-less app boot.

## Shape

`native/supervisor` is a MoonBit native executable with a small C leaf:

- `posix_spawn` of `dist/electron-mbt-native-host`
- three inherited Unix socketpairs placed at child fds 3 (control), 4 (load)
  and 5 (event), matching the host contract
- absolute app root + a fresh 32-hex session from `arc4random_buf` in
  `ELECTRON_MBT_HOST_SESSION`
- 4-byte big-endian length framing around canonical JSON envelopes
- `hello` → `ready` → `create-window` → `begin-load` → `load-file` on the
  load lane → event-lane `isolated-preload-attested` → `destroy-window` →
  `shutdown`
- the loaded file is resolved under the canonical app root by C and sent as a
  JSON path; the load ACK must contain `didFinishLoad:true` and `index.html`
- a linked QuickJS runtime reads `fixtures/native-app/main.js` and evaluates
  its CJS-style body with a synthetic `electron` module; `mainEvaluated:true`
  requires `native-fixture`, and the main's title is read back and applied to
  the window
- the prototype reads `package.json` with QuickJS `JSON.parse`, uses its
  `main` (default `main.js`) and rejects absolute/`..`/backslash entries;
  exports/imports and conditions are **not implemented**
- a local CJS loader over a preloaded fixture source map resolves relative
  specifiers, `.js`/`.cjs`/`.json`, directory `index.*`, caches module identity
  and parses JSON modules; the fixture asserts direct/index cache identity
- a bare `fixture-pkg` resolves through `node_modules`, package.json `exports`
  (`require` then `default`), `main` fallback and package cache identity
- close/EOF and `waitpid` on finish; `SIGKILL` + wait on failure

The supervisor uses the existing host directly; it does not use Node,
Node-API, `sync_channel.node` or the JS runner.

## Evidence

`node scripts/m1-native-supervisor.cjs` builds/runs the executable and parses
the final JSON line:

```json
{"status":"PASS","probe":"native-supervisor-window-load","backend":"AppKit+WKWebView","childPid":83324,"exitStatus":0,"windowLoaded":true,"event":"isolated-preload-attested","mainEvaluated":true,"moduleGraph":true,"packageGraph":true,"appMain":"native-fixture","appEntry":"src/main.js","appTitle":"native-app-window","creator":"moonbit-native","compatible":false}
```

Observed: real native host startup, `hello`/`ready` replies, window creation,
`begin-load`, a load-channel `load-file` ACK with `didFinishLoad:true`, an
event-channel `isolated-preload-attested` notice, a linked-QuickJS fixture app
main, window destroy, `shutdown`, and child exit status 0. A native test also checks
that sessions are 32 lowercase hex characters and differ between draws.

`node scripts/m1-native-supervisor-fault.cjs` passes two negative cases:

- a dead child (`/usr/bin/false`) fails at the `hello` exchange
- a missing app root fails before spawn (`ELECTRON_MBT_SUPERVISOR_START`)
- a package `main` of `../outside.js` fails at app-main admission
  (`ELECTRON_MBT_SUPERVISOR_APP_MAIN`)

Both set `compatible:false` and do not leave the intended session running.

## Deliberate limits

- fixed default `fixtures/m1` root; test-only env overrides select a different
  binary/root. Production needs normal argument/config plumbing and must not
  accept arbitrary supervisor binary/root from ambient environment
- no restart/watchdog policy or orphan sweep beyond the 5s finish timeout and
  explicit kill; no event-loop ownership or broad fault injection
- load/event channels are kept open but the prototype only uses control
- the QuickJS app main and local CJS loader are a C/JS fixture probe over a
  fixed source list; they are not `runtime/runner`, a general node_modules
  resolver, full exports conditions, preload/contextBridge or Node-less Moji
  boot
- no window options beyond the fixed width/height/title/show payload; no
  preload or renderer ingress
- QuickJS sources are linked through package-local symlinks; this is a probe,
  not the production runner package
- no signature, app ID, user-data isolation or update policy
- host stderr may include macOS keyboard-layout diagnostics

## Next

- random session/nonce, root/arg validation and supervisor state machine
- control/load/event routing with request IDs, timeouts, cancellation and
  native event dispatch
- QuickJS runner child or in-process engine ownership
- restart/fault tests, no-orphan checks, shutdown deadlines
- Node-less app main and renderer boot
