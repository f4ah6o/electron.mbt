# M0 reference-baseline admission

Status: implementation increment; M0 remains open and `compatible:false`.
This does not replace or close `issues/polished/0001-electron-compatible-lightweight-runtime.md`.

## Execution boundary

1. `core/baseline.mbt` owns reference admission. Both live collection in
   `scripts/oracle.cjs` and saved-baseline consumption in `scripts/differential.cjs`
   invoke the same compiled `validate_baseline` export.
2. A reference must have schema 1, `baseline-collected`, `compatible:false`, the
   current fixture hash, a completed observation, exact manifest Electron/Node
   versions, recorded platform/architecture, Boolean module identity, a
   non-empty trace and a non-empty object measurement payload. Missing/null/
   mistyped fields and any `abort` field are rejected. Negative measurements
   remain valid observations; an empty payload is not a measured negative.
3. The differential runner validates before launching the candidate fixture.
   Its baseline file read is bounded to 65,536 bytes, rejects nonregular files
   and uses nonblocking open so a FIFO cannot park it before the type check.
   The compiled JSON boundary independently limits the report to 16,384 string
   units. The collector validates the serialized report it actually persists.
4. The collector rejects process errors, signals, nonzero exits and missing,
   duplicate or malformed markers. `--output <file>` isolates runner tests from
   `evidence/electron-baseline.json`; synthetic children are admission tests,
   never actual Electron execution evidence.
5. `compare_observations` retains its arbitrary-observation semantics. Two
   aborted objects may compare equivalent in a pure comparator test, but an
   aborted object cannot be admitted as an Electron reference baseline.

## Verification targets

1. `moon check --target js`; `moon test --target js`; `moon test --target native`.
2. `npm run build`; `npm test`, including baseline contract and runner rejection
   cases and the existing IPC/diagnostic/transport regressions.
3. The existing macOS CI must collect an actual pinned Electron baseline and
   compare it with the unchanged facade fixture. A `diverged` result is expected
   while `ipcMain.on` remains unsupported; it is not a harness failure.
4. Unit and synthetic runner results do not authenticate an externally supplied
   JSON file or prove that a third-party Electron binary is genuine. They are
   consistency/admission checks, not signed provenance or compatibility proof.

## Remaining scope

Safe synchronous isolated contextBridge, native sender/document attestation,
production renderer IPC, native acceptance, Node-less runtime implementation,
real application scenarios, packaging and release measurements remain outside
this increment. Neither existing Draft PR #2 nor Draft PR #3 is modified or
merged by this work. Independent review and native results must be recorded
separately from syntax checks and portable tests.
