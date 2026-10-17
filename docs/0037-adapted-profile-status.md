# Adapted profile status (Moji)

Status: **implementation milestone**, not compatibility. The adapted profile
boots the real Moji renderer with page-world file/dialog/export services and the
pinned Moji main handlers. `compatible:false`, adapted **partial** and strict
**blocked** remain.

## Stage status

| Stage | Evidence | Status |
| --- | --- | --- |
| File broker read/save/image/sample | `fileBroker`/`fileRead`/`fileSave`/`fileDenied`, page probe | PASS (partial) |
| File grants | test-only `grant-file`; no production consent | PARTIAL |
| Native open/save grant path | test-injected `set-dialog-result` | PASS |
| Native open panel UI | `moji-dialog-ui` open/cancel | PASS (open/cancel only) |
| Save panel UI / selection / consent | not exercised | NOT RUN |
| HTML export | `exportHtml` | PASS |
| PDF export | `pdfOk`, fixed A4/Letter/Legal page rect | PASS |
| PNG document export | `docPngOk` via offscreen snapshot | PASS |
| PNG diagram export | `exportPng` from supplied data URL | PASS |
| Page size/orientation | `pdfLandscapeOk` (Letter landscape) | PASS |
| Multi-page/print-accurate export | not implemented | NOT RUN |
| Moji main boot | `moji-main-boot`: whenReady, 1 window, 14 handlers | PASS (virtual) |
| Moji handler invocation | settings/update/readSample/confirmClose | PASS (virtual) |
| Real Moji renderer | `moji-renderer`: real UI text, `rootChildren:1` | PASS (loopback HTTP) |
| Adapted page API → Main | `moji-adapted-native`: dark/unsupported | PASS |
| Adapted API → native broker | real renderer open/save/export/sample | PASS |
| Async Main microtasks | `updateCheckOk` via `checkForUpdate` | PASS |
| Preload virtual evaluation | `api`, 18 methods | PASS (virtual) |
| Preload in WebKit / contextBridge | not executed; M0 gate unresolved | FAIL/NOT RUN |
| Production asset loading | loopback server is test-only | NOT IMPLEMENTED |
| Timers/native promises/cancel | not supported by async bridge | NOT IMPLEMENTED |

## Aggregate evidence

- `verify-state`: 16/16 PASS, `NOT_READY`
- readiness: 31 checks, 24 PASS, 2 FAIL (`moji-preload-runtime`,
  `moji-m1-boot`), 5 NOT RUN
- `npm test`: 428 pass
- `moon test --target js`: 129 pass
- `moon test --target native`: 148 pass
- native supervisor/source snapshot/boot/renderer/dialog-ui probes: PASS

## Remaining scope

1. **M0 contextBridge gate**: safe synchronous contextBridge across
   WKContentWorlds; until resolved, the original preload stays NOT_EXECUTED.
2. **Production asset loading**: replace the test-only loopback server with a
   native/custom-scheme or packaged asset path.
3. **Dialog depth**: real file selection, save panel, user consent and grant
   persistence.
4. **Async depth**: timers/native completion promises, cancellation, deadlines.
5. **Export depth**: multi-page/print-accurate PDF/PNG, `assetBaseUrl`.
6. **Compatibility**: no verified rows; strict profile remains blocked.

This document is a checkpoint, not an acceptance of Electron compatibility.
