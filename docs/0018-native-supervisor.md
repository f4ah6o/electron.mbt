# MoonBit-native supervisor handshake (EP-10 prototype)

Status: **prototype PASS for the private handshake only**. This is the first
MoonBit-native process that spawns and controls the real AppKit/WKWebView host
without Node. It is not a complete supervisor, app launcher or Node-less boot.

## Shape

`native/supervisor` is a MoonBit native executable with a small C leaf:

- `posix_spawn` of `dist/electron-mbt-native-host`
- three inherited Unix socketpairs placed at child fds 3 (control), 4 (load)
  and 5 (event), matching the host contract
- absolute app root + a fresh 32-hex session from `arc4random_buf` in
  `ELECTRON_MBT_HOST_SESSION`
- 4-byte big-endian length framing around canonical JSON envelopes
- `hello` → `ready` → `shutdown`
- close/EOF and `waitpid` on finish; `SIGKILL` + wait on failure

The supervisor uses the existing host directly; it does not use Node,
Node-API, `sync_channel.node` or the JS runner.

## Evidence

`node scripts/m1-native-supervisor.cjs` builds/runs the executable and parses
the final JSON line:

```json
{"status":"PASS","probe":"native-supervisor-handshake","backend":"AppKit+WKWebView","childPid":73832,"exitStatus":0,"creator":"moonbit-native","compatible":false}
```

Observed: real native host startup, `hello` reply with `AppKit+WKWebView`,
`ready` reply, `shutdown` reply, child exit status 0. A native test also checks
that sessions are 32 lowercase hex characters and differ between draws.

`node scripts/m1-native-supervisor-fault.cjs` passes two negative cases:

- a dead child (`/usr/bin/false`) fails at the `hello` exchange
- a missing app root fails before spawn (`ELECTRON_MBT_SUPERVISOR_START`)

Both set `compatible:false` and do not leave the intended session running.

## Deliberate limits

- fixed default `fixtures/m1` root; test-only env overrides select a different
  binary/root. Production needs normal argument/config plumbing and must not
  accept arbitrary supervisor binary/root from ambient environment
- no restart/watchdog policy or orphan sweep beyond the 5s finish timeout and
  explicit kill; no event-loop ownership or broad fault injection
- load/event channels are kept open but the prototype only uses control
- no window creation, preload/contextBridge, app main, QuickJS runner or
  Node-less Moji boot
- no signature, app ID, user-data isolation or update policy
- host stderr may include macOS keyboard-layout diagnostics

## Next

- random session/nonce, root/arg validation and supervisor state machine
- control/load/event routing with request IDs, timeouts, cancellation and
  native event dispatch
- QuickJS runner child or in-process engine ownership
- restart/fault tests, no-orphan checks, shutdown deadlines
- Node-less app main and renderer boot
