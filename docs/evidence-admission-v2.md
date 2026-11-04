# Evidence bundle v2 admission

Status: implemented validation contract; no compatibility claim.

`scripts/evidence-admission.cjs` validates the versioned bundle described by
`compatibility/evidence-schema-v2.json`. It currently has dedicated tests but
is not wired into the runtime CLI or the G0–G4 report generator. The active
schema-1 manifest and specialized baseline/probe readers keep their own
admission paths. This guard does not execute an oracle, prove semantic equality,
authenticate digests, or promote a profile to compatible.

The JSON Schema describes the envelope's structure. Its descriptions document
cross-field rules; they do not execute those rules in a generic JSON Schema
validator. `validateEvidence` performs the additional outcome/profile checks
described below and selected structural checks. It is not a full JSON Schema
validation engine.

## Consistent outcomes

A bundle could previously describe a completed, equivalent run despite a
timeout or terminating signal. It could also claim a scope outside its profile,
or use dependency adaptations under the strict Node-less profile. Admission now
rejects these contradictions before they can be used in future gate aggregation.

| Recorded result | Admission condition |
| --- | --- |
| Completed harness | Exit code 0, no signal and no timeout |
| Equivalent or expected-rejection semantics | Completed harness and no not-run or stalled observations |
| Satisfied profile/scope gate | Completed, equivalent result with no missing evidence |
| Expected rejection | Retained as negative-test evidence with an open or blocked gate |
| Failed, invalid or not-run harness | Retained when the result does not claim successful semantics or a satisfied gate |

The negative-test rule follows the verdict table in
[issue 0015](../issues/polished/0015-oracle-ci-and-evidence.md): a successful
rejection test does not establish app/profile acceptance. Individual rejected
observations and observed exceptions may still belong to an equivalent result;
their meaning is checked by the specialized comparator. Explicit null values
remain distinct from missing fields. Invalid observation containers or entries
return validation problems instead of throwing.

The execution and verdict scopes must agree and belong to the selected entry in
`runtime-profiles-v1.json`. `desktop-core-v1` can record `native-probe`; it cannot
rename that scope to `native-ingress`. The strict `electron-nodeless-v1` profile
requires an empty dependency-adaptation list. Unit comparisons are restricted to
`unit` or `kernel` scope. Negative comparisons cannot satisfy a positive
profile/scope gate, including when labeled `equivalent`. A rejected bundle is ineligible
for aggregation; this does not delete or suppress its raw failure logs.

## Reproduce

```sh
node --test tests/evidence-admission.test.cjs
node --test tests/manifest-v2.test.cjs tests/gate-report.test.cjs tests/preview-readiness.test.cjs
```

These tests validate admission and preserve the existing open gates. They are
not macOS/WebView, unchanged-preload, or Electron compatibility evidence.
`compatible:false` and the blocked strict runtime profile remain unchanged.
