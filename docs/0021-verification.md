# Current-state verification

Status: **NOT_READY**. `scripts/verify-state.cjs` runs the complete recorded
verification sequence and writes `compatibility/reports/verification.json`.
It exits 0 only when every command behaves as expected, including the expected
`NOT_READY` exit 2 from the readiness validator.

## Result

16 checks, 0 unexpected failures:

- `moon test --target js`
- `moon test --target native`
- `npm test`
- `npm run build`
- `scripts/build-macos-host.cjs`
- `scripts/m1-macos-smoke.cjs`
- `scripts/m1-app-smoke.cjs`
- `scripts/m1-native-supervisor.cjs`
- `scripts/m1-native-supervisor-fault.cjs`
- `scripts/m1-native-supervisor-retry.cjs`
- `scripts/m1-source-snapshot.cjs`
- `scripts/adapted-preload-check.cjs`
- `scripts/adapted-api-check.cjs`
- `scripts/moji-adapted-check.cjs`
- `scripts/preview-readiness.cjs` (expected exit 2, NOT_READY)
- `scripts/gate-report.cjs`

`status:NOT_READY` in the report is the honest overall state, not a command
failure. The verification does not sign, notarize, install on a clean machine,
boot Moji without Node, or run interactive IME/focus/AX acceptance.

## Reproduce

```sh
node scripts/verify-state.cjs
node scripts/preview-readiness.cjs
node scripts/gate-report.cjs
```
