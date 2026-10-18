# M0 contextBridge B5 spike — repaired synchronous renderer primitive

Status: **B5 spike executed; decision `go` for the tested macOS/WebKit build; production `contextBridge` NOT_IMPLEMENTED.** This is a
test-only investigation, not production `contextBridge`. `contextBridge` stays
`NOT_IMPLEMENTED`, M0 stays OPEN, `compatible:false` and ordinary `run`/`pack`
stay fail-closed. No unchanged-app or Electron compatibility is claimed.

## Question

Can a repaired public-WebKit renderer primitive expose an **unchanged**
Electron oracle preload's `contextBridge.exposeInMainWorld()` API to the first
page script with synchronous return/throw, response integrity against page
forgery, callbacks, nested/reentrant calls, Promises, frozen copies and
navigation revocation?

This is the bounded re-investigation required by
[issue 0007 §5.1](../issues/polished/0007-context-bridge-feasibility-and-security.md).
The existing `docs/0003-m0-contextbridge-feasibility.md` candidate is
synchronous but page-forgeable and carries no callables. This spike tries one
repair and stops at checkpoint 1 if response integrity fails.

## Public primitive and hypothesis

The single primitive under test is **synchronous cross-world
`dispatchEvent`** (already observed by the M0 probe) between the page world and
a named isolated `WKContentWorld`, with the message payload stored in a shared
DOM element.

Hypothesis: the existing negative (page-forgeable reply) can be repaired with:

1. a per-probe 256-bit secret injected by native into both host-installed
   document-start scripts as an IIFE argument, never written to DOM, globals,
   errors, storage or logs;
2. a test-only HMAC-SHA-256 over
   `direction | sessionId | messageId | payloadJson`;
3. a per-document public `sessionId` plus a page-generated freshness challenge;
4. captured primordials and bounded value/handle handling on both sides.

The page may observe and mutate the shared DOM at any time. It must still be
unable to make the page shim accept a forged synchronous result.

The mechanism is **not** Electron's V8/Blink cross-context proxy. Even a `go`
only permits a separate B6 implementation/security review; it is not a
compatibility claim.

## Unchanged oracle fixture

The spike reuses, byte for byte:

- `fixtures/oracle/preload.cjs` (the sandboxed-style Electron 44.7.0 oracle
  preload with `contextBridge`/`ipcRenderer`)
- `fixtures/oracle/index.html` (the pinned first-script semantics page)

The preload source is executed inside a test-only CommonJS wrapper in the
isolated world. That wrapper is not Electron's sandboxed preload environment;
only `require('electron')` with the fixture's used subset is provided.

## Checkpoints (pre-registered)

### Checkpoint 1 — stop here if it fails

- `window.fixture` is available in the first page script.
- `syncValue()` returns exactly `42` synchronously, not a Promise/thenable.
- `syncThrow()` throws synchronously with the pinned Error realm evidence.
- Page forgery attempts (pre-seeded reply, a later listener overwriting the
  reply, a capture listener blocking the bridge, MAC/session tampering) never
  yield the forged sentinel. The call returns `42` or fails closed with a typed
  bridge error.
- The secret is not visible in page DOM, scripts, storage, globals or exposed
  function source; page world cannot reach the isolated handler or registry.

If any of these fails, checkpoint 2 is not attempted and the result is
`no-go` (or `blocked` for a named harness failure).

### Checkpoint 2 — only after checkpoint 1 passes

- The unchanged oracle page observation matches the pinned Electron 44.7.0
  validator: Promise `43`, rejection realm, frozen/deep-frozen data, callbacks
  `['first','second']`, removal-by-original-identity `false`, disposer
  once/twice, subscription `['sub-first']`, isolated primordials.
- Callback-driven nested/reentrant calls, callback throw reconstruction,
  bounded/unsupported value rejection.
- Sandboxed child frame cannot access `parent.fixture`, cannot reach native
  handlers, and its `postMessage` is not relayed by the probe page.
- Same-URL reload re-runs the unchanged preload with fresh state/session/grant;
  a stale native grant is rejected.

## Stages

1. `fixtures/worlds/m0-cb-checkpoint1.html` — first-script sync/throw,
   forgery attempts, secret/handler visibility; writes
   `globalThis.m0ContextBridgeCheckpoint1`; sends one liveness report.
2. `fixtures/oracle/index.html` — unchanged positive observation through the
   bridge; compared to `evidence/electron-baseline.json` when available.
3. Same-url reload of the oracle page — fresh observation and stale native
   grant rejection.
4. `fixtures/worlds/m0-cb-negative.html` — reentrancy, pollution, bounds,
   sandboxed child; writes `globalThis.m0ContextBridgeNegative`.

Native navigation policy allows only these exact URLs plus
`fixtures/worlds/m0-cb-child.html`; unexpected navigations fail closed.

## Security boundaries

- The shared DOM is not a trusted native sender. The HMAC only protects the
  test bridge's page<->preload messages; it does not authenticate a page
  initiator to native.
- The only native lane is a test-only report stub (`ipcRenderer.send`). Native
  validates the actual `WKScriptMessage` main frame, WebView, URL, handler
  name and a per-document grant. It only records evidence and performs no
  file/OS/network action.
- The preload remains in the isolated world. No page-world preload, private
  WebKit selector, disabled sandbox/isolation, `postMessage`/`evaluateJavaScript`
  synchronous substitution or UI-thread/native-blocking call is used.
- The HMAC and CJS wrapper are test-only. B6 must not promote them without a
  separate security review and MoonBit-owned authority/lifetime/bounds.

## Commands

```sh
node scripts/m0-context-bridge-probe.cjs --build-only   # build only
node scripts/m0-context-bridge-probe.cjs                # real macOS execution
node --test tests/m0-context-bridge-codec.test.cjs
node --test tests/m0-context-bridge-evidence.test.cjs
npm test
moon test --target js
moon test --target native
```

Linux and a host without WindowServer report `NOT_RUN`/`FAIL`, never a
technical `go`/`no-go`.

## Results (2026-10-18)

Executed on macOS 26.5.2 (Build 25F84), arm64, SDK 26.5, WebKit
`21624.2.5.11.8`, Node v24.22.0. The pinned Electron oracle version remains
44.7.0. This environment is a local macOS run; the Electron baseline
differential is **NOT RUN** here because the separate pinned Electron install
was not present. The unchanged fixture was validated against the pinned
observation expectations, and CI runs the differential after collecting the
baseline.

`node scripts/m0-context-bridge-probe.cjs --build-only` — **PASS** (build only,
execution NOT RUN).

`node scripts/m0-context-bridge-probe.cjs` — **PASS**, decision **go**:

| Observation | Result |
| --- | --- |
| Checkpoint 1: `window.fixture` at the first page script | PASS |
| Checkpoint 1: `syncValue()` strictly `42` (type `number`) | PASS |
| Checkpoint 1: synchronous throw with pinned Error evidence | PASS |
| Checkpoint 1: pre-seeded forged reply accepted | NO (failed closed) |
| Checkpoint 1: later listener forged result accepted | NO (failed closed) |
| Checkpoint 1: capture-blocking forged result accepted | NO (failed closed) |
| Checkpoint 1: after-listener mutation forged result | NO (returned authentic `42`) |
| Checkpoint 1: secret visible in DOM/storage/globals/exposed source | NO |
| Checkpoint 1: bridge internals/native handlers visible to page | NO |
| Checkpoint 1: liveness report through the test report lane | PASS |
| Checkpoint 2: unchanged oracle observation | PASS |
| Checkpoint 2: unchanged oracle observation after same-url reload | PASS |
| Checkpoint 2: nested/reentrant call returns `42` | PASS |
| Checkpoint 2: callback throw reconstructed in page realm | PASS |
| Checkpoint 2: bridge unaffected by page prototype/DOM/JSON tampering | PASS |
| Checkpoint 2: unsupported, oversize and cyclic values rejected | PASS |
| Checkpoint 2: sandboxed child cannot reach the API or native handler | PASS |
| Checkpoint 2: child `postMessage` is not relayed to the bridge | PASS |
| Navigation: grant rotated on every main-frame navigation | PASS (4 grants, 4 handshakes) |
| Navigation: stale native grant rejected | PASS (1 rejection) |
| Fixture source hashes preserved | PASS |
| Electron baseline differential | **NOT RUN locally** (CI step) |

The unchanged oracle observation passed the pinned validator for both
documents: Promise `43`, rejection realm, frozen and copied data, callback
values `['first','second']`, removal-by-original-identity `false`, disposer
once/twice, subscription `['sub-first']` and isolated primordials.

Recorded evidence: `evidence/m0-context-bridge.json` (CI artifact). Preload
`fixtures/oracle/preload.cjs` was 1085 bytes, SHA-256
`6b3d53ca6aecc2cd2d4e7a5b598ff18599f7bb7d54decec9f58b4cf11f7b7543`;
the oracle fixture hash was
`2bc084c9ebf0c5abc0cbc9ac8e9859a39e5ae725e4aab0f7e3e5d447672c3fa0`.

Full-suite results at B5 completion: `npm test` 443 pass / 0 fail;
`moon test --target js` 129 pass; `moon test --target native` 148 pass; the
portable `node --test tests/m0-context-bridge-codec.test.cjs
tests/m0-context-bridge-evidence.test.cjs` 15 pass; `node scripts/verify-state.cjs`
17/17 expected, overall `NOT_READY` (B6-A later added contract tests; see [B6 design](0039-b6-strict-context-bridge.md)). The probe was executed repeatedly (including after timing and race fixes) with the same `go` decision. These are test results, not a compatibility promotion.

### Decision

**go** for the tested environment. This means B6 may be planned; it does
**not** close M0, does not make this test-only bridge production code and does
not authorize the original preload, `run`, `pack` or any verified row.
Checkpoint 1 and 2 both passed with no accepted forged reply and no observable
secret. The stale-grant and reload observations are scoped to this WebKit
build.

### Limitations and remaining B6 work

- test-only shared-DOM/HMAC mechanism; not Electron's engine-level proxy.
- test-only CommonJS wrapper, not Electron's sandboxed preload environment.
- report lane is a fixture transport with no privileged operation.
- one macOS/WebKit build; no Windows/Linux inference.
- a page can still deny its own bridge (remove the transport, block event
  propagation, replay a captured call). That is self-DoS or an ordinary call,
  not a privilege; it is not treated as a candidate pass.
- a same-origin iframe's access to the parent's page-world API is not
  exercised here; B6 must define frame policy separately. The sandboxed child
  negative is not a full frame model.
- the page can always call the functions the preload chose to expose; the
  bridge does not authorize the exposed API itself.
- B6 still needs a production preload/bridge leaf, MoonBit-owned
  exposure/handle/quota/revocation policy, native document/frame authority,
  full value/error/callback/Promise semantics, unchanged-app differential and
  independent security review.

## Remaining after a `go`

A separate B6 plan must implement the production preload/bridge leaf, native
document/frame authority, MoonBit-owned exposure/handle/quota/revocation
policy, full value/error/callback/Promise semantics, differential evidence and
independent security review. M0 does not close and the strict profile does
not unblock on a B5 `go` alone.

## References

- [M0 feasibility report](0003-m0-contextbridge-feasibility.md)
- [Issue 0007: contextBridge feasibility and security](../issues/polished/0007-context-bridge-feasibility-and-security.md)
- [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)
- [Apple WKContentWorld](https://developer.apple.com/documentation/webkit/wkcontentworld)
