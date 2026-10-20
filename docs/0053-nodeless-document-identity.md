# Node-less document identity and reload authority

Status: **Phase 2 increment implemented; strict compatibility and a full
production ingress are not claimed.** `compatible:false`, M0 OPEN, the original
preload NOT_EXECUTED and the strict profile blocked are unchanged.

## Problem

The Node-less CLI hard-coded `window = 1` and `generation = 1` in
`native/nodeless/main.mbt` and in every control frame sent by
`native/nodeless/host_client.c`. The native host already stamps the actual
window and generation on `app-request` events, but the MoonBit pump accepted
only the literal pair. A stale event from an earlier document could therefore
pass the literal check, and a reload could not advance its generation. The
adapted adapter install also refused a second load (`generation != 0` or an
existing adapter source), so reload was not a usable path.

## Change

1. `host_client.c` now owns the single Node-less window identity. `begin-load`
   advances the generation before a navigation; `load-file` /
   `load-app-file` send that generation; all control frames use the active
   window/generation instead of literals. `moonbit_ebt_nodeless_host_identity`
   exports the current pair to MoonBit.
2. `native/nodeless/main.mbt` fetches that identity and rejects any
   `app-request` whose window/generation does not match before calling Main.
   The report now records `documentGeneration` and `adapted.rejected`.
3. Reload support:
   - `prepare-source` may stage a new snapshot after a completed load (still
     refused while a navigation is in flight);
   - `install-adapted-adapter` may refresh the adapter source on reload and
     installs its page-world handlers only once;
   - `begin-load` still invalidates the old document before the new load.
4. The native host releases the adapted adapter queue automatically when the
   document load completes, and `get-adapted-status` reports `released`. The CLI
   waits for that flag instead of calling the explicit
   `release-adapted-ingress` test control.
5. A test-only `inject-app-request` native operation and
   `--ingress-selftest` CLI mode (both gated by
   `ELECTRON_MBT_TEST_MODE=1`) inject one stale-generation and one
   current-generation event. The CLI reports whether the stale event was
   rejected and the current one reached Main. The operation is not in the
   QuickJS app allowlist.

## Evidence

| Command | Result |
| --- | --- |
| `node --test tests/nodeless-runtime.test.cjs` | **30 PASS** (includes plain reload to generation 2, adapted reload to generation 2, stale event rejected, forged claims ignored, malformed page message denied) |
| `npm test` | **486 pass / 0 fail** |
| `moon test --target js` | **145 pass** |
| `moon test --target native` | **178 pass** |
| `node scripts/preview-readiness.cjs` | **NOT_READY** (unchanged 27 PASS / 2 FAIL / 5 NOT RUN) |

Observed ingress selftest:

```json
{"ok":true,"staleInjected":true,"liveInjected":true,"handled":1,"errors":0,"rejected":1,"window":1,"generation":1,"staleGeneration":0}
```

Observed reloads: a plain app and an adapted app both ended at
`documentGeneration: 2`. The adapted reload dispatched its current-generation
request and rejected the previous document's late request (`rejected: 1`);
the non-reload adapted scenario reports `rejected: 0`.

Environment: macOS 26.5.2 / arm64, local Node 24.22.0 (not the pinned 24.21.0
oracle), MoonBit 0.1.20261012. This is local test evidence, not a pinned CI or
Electron differential result.

## Limits

- The Node-less host still exposes one main window. A second `create-window`
  is refused rather than reusing window 1 with stale state.
- The explicit `release-adapted-ingress` control remains a test control. The
  production path releases the adapter queue automatically when the document
  load completes; the CLI now waits for `get-adapted-status.released` instead of
  calling the control.
- The current event in `--ingress-selftest` carries forged
  window/generation/sender/origin claims; the pump ignores them and the event
  is still handled. A malformed main-frame page message is denied at the native
  ingress, and an iframe/`srcdoc` attempt does not reach Main. A dedicated proof
  that a **subframe handler message** is rejected is still missing; the
  Node-less navigation policy is already main-frame-only, so the subframe did
  not load in this run.
- `inject-app-request` is test-only and fails without
  `ELECTRON_MBT_TEST_MODE=1`; it is not a user-facing API.
- No strict-profile admission, no `compatible:true`, no A–J row promotion.

## Next

1. Add Node-less child-frame, forged-payload-sender and reload-race negatives.
2. Add a dedicated subframe-handler rejection proof if the frame policy is
   relaxed.
3. Then start Phase 3: grant persistence/revocation and normal save/restart.
