# electron.mbt development

The source of truth is `issues/open/0001-electron-compatible-lightweight-runtime.md`.

## Implementation boundaries

1. MoonBit owns lifecycle, identifiers, policy, transport contracts, compatibility validation and diagnostics. Handwritten JavaScript is leaf glue for real Node.js and JS function/listener identity, not a parallel implementation of the core.
2. Use real Node.js and system WebViews. Do not bundle Electron/Chromium as a hidden fallback, rewrite app source, disable isolation/security, or silently turn synchronous APIs into promises.
3. Follow M0 feasibility gates before claiming M1/M2 compatibility. In particular, safe synchronous contextBridge across WKContentWorlds is an unresolved gate, not something a postMessage shim proves.
4. Implement reviewable increments and preserve the complete remaining scope of issue 0001. Keep planned, partial, verified and unsupported distinct. Keep the issue open until its runtime acceptance criteria really pass.
5. Never discard unrelated changes, reset/clean existing work, force-push, weaken branch protection, or modify other repositories. Main updates need explicit authorization (the current implementation task authorizes main delivery).

## Validation and reporting

1. Test pure MoonBit contracts with deterministic tests on the selected targets. Test adapters with positive and negative integration tests, including fail-closed behavior and source/asset hash preservation.
2. Pin the oracle/runtime/toolchain versions used for a compatibility result and attach real evidence. A fake backend, static scan, compilation, skipped native test, or Linux run is not macOS/WebView compatibility evidence.
3. Report commands and PASS / FAIL / NOT RUN separately. Record environment blockers and open gates without claiming completion, size savings or native E2E success.
4. Code expresses how; tests describe what; commit messages explain why; comments explain why an obvious alternative was not used.

## Review guidelines

Prioritize incorrect success/verified claims, secret or privilege exposure, prototype/realm boundary violations, navigation/document-generation reuse, unbounded payloads or pending work, symlink/root escapes, duplicate completions, synchronous semantics and event-ordering regressions. Test findings before resolving them. Do not infer production readiness from a passing unit suite.
