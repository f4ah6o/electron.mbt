# Preview readiness validator (G0–G4 gate)

Status: **NOT_READY**. `scripts/preview-readiness.cjs` checks the recorded
profiles, app closures, SBOMs, preload gate and supervisor evidence, and writes
`compatibility/reports/preview-readiness.json`. A `PASS` check means an
invariant or honest record passed; it never means app compatibility.

## Current result

- status: `NOT_READY`, `compatible:false`
- gates: G0 partial, G1 partial, G2 partial, G3 `NOT_RUN`, G4 partial
- 33 checks: 26 PASS, 2 FAIL, 5 NOT_RUN
- failures: functional contextBridge/ipcRenderer is not implemented; the Moji
  M1 boot is a recorded FAIL at `contextBridge.exposeInMainWorld`
- adapted: generated page adapter, document-start page-world injection, the
  Node-less Moji renderer, its test-injected broker flow and `language:"ja"`
  settings persistence are PASS; the original preload is still NOT_EXECUTED
- NOT_RUN: production file consent/human dialog UI, print-accurate PDF export,
  signing, clean install, interactive IME/focus/accessibility

## Invariants it enforces

- no `verified` rows are silently promoted
- `manifest.compatible` remains false
- the strict Node-less profile stays blocked
- the adapted fixture adapter hash, page-world injection and NOT_EXECUTED original
  preload are checked
- production closures are PASS with zero native addons
- SBOM component/hash counts match the production closure
- the Moji preload gate is recorded as NOT_IMPLEMENTED
- the Moji M1 boot remains a FAIL, not a success
- the Node-less Moji renderer requires the pinned main/preload/adapter hashes,
  custom page URL, real UI text and adapted ingress counts
- the Node-less broker requires the explicit test flag, one grant, six dialog
  results, a done `apiProbe`, six verified output files and a persisted
  `.appData/moji/settings.json` (`settingsPersisted:true`)
- the native supervisor fixture probe is PASS but does not count as app boot
- signing, clean install and interactive acceptance remain NOT_RUN

## Commands

```sh
node scripts/preview-readiness.cjs
node --test tests/preview-readiness.test.cjs
```

The script exits 2 while the report is NOT_READY. It does not sign, pack,
install, launch Moji, or mutate app records.
