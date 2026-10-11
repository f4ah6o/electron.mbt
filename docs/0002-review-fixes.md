# PR 2 transport review fixes

Status: partial M1 contract implementation. No native host or Electron-compatible
`run` path is provided by this change. PR 2 remains draft; M0 gates remain open.

## Ownership

1. `transport/wire.mbt` owns protocol version, operations, terminal values,
   identifiers, payload policy and resource budgets. Its bounded recursive
   parser compares decoded keys before building each object. The standard JSON
   parser is only used on isolated scalar tokens, never an unchecked container.
   Literal/escaped duplicate names at any nesting level are rejected. Host wire
   strings must be well-formed Unicode; unpaired surrogates are rejected.
2. `transport/session.mbt` owns outstanding request identities, monotonic
   non-reusable IDs, correlation, pending count/byte bounds, completion,
   cancellation and close. Failed validation leaves all ledgers unchanged.
   Out-of-order completions are allowed; out-of-order issuance is not.
3. `bridge/host.mbt` exports the actual compiled MoonBit implementation through
   the existing CJS build. `host-protocol.cjs` is Buffer/fatal UTF-8 and JS
   object materialization glue; it has no second operation or session policy.
4. `bounded-json.cjs` reflects JS-only value shapes without getters, coercion,
   proxy traps or `toJSON`. It emits only supported primitive encodings under
   budgets obtained from MoonBit, measuring escaping/UTF-8 before allocating
   encoded strings or Buffers. Unsupported JS values cannot disappear or turn
   into null/zero before MoonBit validates the wire. It does not define envelope
   operations, identity policy or session state.

## Limits and lifecycle

The MoonBit limits are 1 MiB per envelope, depth 64 and 100,000 nodes per payload,
256 pending controls and 4 MiB of pending envelope bytes. The wire budget adds
only the outer envelope and its fixed header fields. IDs are positive exact JS
safe integers; the per-session watermark prevents reuse without a growing
terminal-history set. `close()` returns the pending cancellation IDs exactly
once and rejects further use. A transport-loss/timeout adapter must close the
whole gate, not merely cancel one request. No such OS adapter is claimed here.

Session-string matching is correlation, **not authenticated OS peer identity**.
Native sender/document attestation, process-loss delivery, callback revocation,
real AppKit/WKWebView integration and interactive/native E2E remain unimplemented.

## Validation entry points

1. `moon check --target js` and `moon test --target js` / `--target native` build
   and test the same protocol and ledger (including tests that bypass Node).
2. `npm run build` produces `dist/core.cjs`; protocol integration tests require
   this real output and fail when it is absent. No JS substitute core is used.
3. `npm test` includes the existing protocol/replay tests and new adversarial
   wire, outbound reflection, exact byte boundary, depth/cardinality and queue
   budget tests. `node --test tests/bounded-json.test.cjs` is only the narrower
   standalone leaf suite and is not MoonBit/native runtime evidence.

Exact execution outcomes belong in the PR record and CI for the tested commit.
A passing contract suite does not close native acceptance or compatibility gates.
