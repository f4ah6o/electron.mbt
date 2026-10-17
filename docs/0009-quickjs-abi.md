# QuickJS native ABI (R1a / EP-08)

Status: implementation increment; R1a is **partial**. The engine is pinned and a
minimal explicit-lifetime ABI passes its current native tests. QJS-05, an
independent ownership review, sanitizer evidence, scheduler integration and the
CJS loader remain open. This is not a Node-less runtime or app acceptance.

## Pin

| Item | Value |
| --- | --- |
| Engine | QuickJS 2026-06-04 |
| Source | `https://bellard.org/quickjs/quickjs-2026-06-04.tar.xz` |
| Tarball SHA-256 | `b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a` |
| License | MIT; `vendor/quickjs/LICENSE` |
| License SHA-256 | `598fd7fc928e4350abce36e337ba5a1346923c5c692f5be92c3d8e29ddd7c18d` |
| Source package | `bridges/embedded-js/` (engine core + adapter only) |
| Lock | `vendor/quickjs/lock.json` |

`quickjs-libc.c`, `qjs.c`, `qjsc.c` and `run-test262.c` are deliberately not
compiled. The runtime does not expose QuickJS `std`/`os`/process/network
helpers. Source-file hashes and the lock are checked by
`tests/quickjs-lock.test.cjs`.

## ABI

`bridges/embedded-js/quickjs_adapter.c` exposes explicit C-managed handles:

| Operation | Contract |
| --- | --- |
| `moonbit_emb_engine_create` | New runtime, 128 MiB heap limit, 1 MiB stack limit, interrupt handler |
| `moonbit_emb_context_create` | One main JS context; no WebView realm sharing |
| `moonbit_emb_eval` | Global script eval; returns a value/exception lease |
| `moonbit_emb_value_kind` | `0` value, `1` exception, `-1` invalid/released handle |
| `moonbit_emb_value_text` | Bounded UTF-8 JSON/text representation |
| `moonbit_emb_value_dup` / `release` | Independent `JS_DupValue` lease and explicit `JS_FreeValue` |
| `moonbit_emb_execute_one_job` | `0` idle, `1` executed, `-1` engine exception |
| `moonbit_emb_job_pending` | Diagnostic only; not a Promise-state copy |
| `moonbit_emb_interrupt` / `clear_interrupt` | Bounded interruption flag for the engine |

The C adapter checks null contexts and does not let a QuickJS exception unwind
through MoonBit. A value lease never exposes `JSValue` or `JSRuntime*` to
MoonBit or to a renderer. The MoonBit package is gated to the native target and
is not imported by the JS bridge.

## Verified on this integration environment

`moon test --target native -p bridges/embedded-js` passes:

- primitive/object eval and synchronous throw text (QJS-01 partial)
- duplicated and independently released value leases; released/stale lease IDs fail closed through a bounded live-lease registry (QJS-02 partial)
- pending Promise job execution and a later-evaluation check (QJS-03 partial)
- interrupt of an unbounded loop and recovery (QJS-04 partial)
- invalid UTF-8 source and a 1 MiB heap limit produce typed exceptions without aborting later evaluation (QJS-05 partial)

`moon test --target native` passes the complete native suite including these
tests. A compile-only result is not acceptance.

## Open before R1b/R2

- QJS-05: callback/OOM exit, forced-GC root-count evidence and an ASAN/sanitizer run
- cross-context lease rejection and a complete root-count ledger
- callback trampolines, finalizer/gc_mark review and independent ownership review
- nextTick/timer ordering, unhandled-rejection policy and host-loss cancellation
- CJS module cache/cycle/identity and Node subset; these are not implied by eval
- a real Node-free runner and process cleanup audit

No release artifact, Node-free claim, CJS loader, BrowserWindow or Electron
compatibility is enabled by this increment.
