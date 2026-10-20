# Adapted profile status (Moji)

Status: **implementation milestone**, not compatibility. The adapted profile
boots the real Moji renderer with page-world file/dialog/export services and the
pinned Moji main handlers. A separate Node-less lane now boots the same real
renderer through a snapshot-scoped custom scheme and the generated page API.
`compatible:false`, adapted **partial** and strict **blocked** remain.

## Stage status

| Stage | Evidence | Status |
| --- | --- | --- |
| File broker read/save/image/sample | `fileBroker`/`fileRead`/`fileSave`/`fileDenied`, page probe | PASS (partial) |
| File grants | test-only `grant-file`; session-scoped main grants from panel completion/test scenario; no production consent | PARTIAL |
| Main-side user-file grants (session) | `nodeless-user-file-app`: granted outside-root read/write, ungranted `EACCES`, app-code self-grant denied | PASS (test-injected) |
| Main grant persistence / revocation | `nodeless-runtime`: store 0600/atomic, second process loads read+readwrite, revoke denies read/write, corrupt/non-canonical store fails closed, restart normal-save fixture uses the persisted readwrite grant | PASS (trusted-main/test-only; human consent NOT RUN) |
| Native open/save grant path | test-injected `set-dialog-result`; main open/save test queues | PASS |
| Native open panel UI | `moji-dialog-ui` open/cancel; `nodeless-dialog-ui` open/cancel | PASS (open/cancel only) |
| Main open dialog (Node-less) | `nodeless-dialog-app`: test-injected read grants, native open/cancel | PASS (partial) |
| Main save dialog + write consent (Node-less) | `nodeless-dialog-app`: test-injected readwrite grants, new/existing targets, cancel, cap, denials; `nodeless-dialog-ui` save open/cancel | PASS (test-injected; human selection NOT RUN) |
| HTML export | `exportHtml` | PASS |
| PDF export | `pdfOk`, fixed A4/Letter/Legal page rect | PASS |
| PNG document export | `docPngOk` via offscreen snapshot | PASS |
| PNG diagram export | `exportPng` from supplied data URL | PASS |
| Page size/orientation | `pdfLandscapeOk` (Letter landscape) | PASS |
| Multi-page/print-accurate export | not implemented | NOT RUN |
| Moji main boot | `moji-main-boot`: whenReady, 1 window, 14 handlers | PASS (virtual) |
| Moji handler invocation | settings/update/readSample/confirmClose | PASS (virtual) |
| Real Moji renderer | `moji-renderer`: real UI text, `rootChildren:1` | PASS (loopback HTTP) |
| Node-less real renderer | `nodeless-moji-app`: real UI text, custom app scheme, 2 main requests | PASS (adapted; custom scheme) |
| Node-less broker E2E | `nodeless-moji-app` broker: 1 grant/6 dialogs, open/save/sample/saveAs/HTML/PDF/PNG, 6 output files | PASS (test-injected) |
| Node-less document identity / reload | `nodeless-runtime`: plain and adapted reload to generation 2; stale-generation event rejected before Main; forged page claims ignored; malformed page message denied; adapter ingress auto-released at load; `--ingress-selftest` test-only | PASS (test-only; single window; dedicated subframe-handler proof still open) |
| Main-side fs (app root / data roots) | `nodeless-fs-app`: sync/async read, 200 KiB round-trip, atomic `.appData` write, symlink-escape denial; Moji `settingsPersisted:true` | PASS (partial; host-required) |
| Directory/metadata fs | `nodeless-fs-app`: partial stat, bounded readdir/Dirent, bounded mkdir; generated escape and 4,097-entry/65-component bound tests | PASS (partial; host-required) |
| Adapted page API → Main | `moji-adapted-native`: dark/unsupported | PASS |
| Adapted API → native broker | real renderer open/save/export/sample | PASS |
| Async Main microtasks | `updateCheckOk` via `checkForUpdate` | PASS |
| Preload virtual evaluation | `api`, 18 methods | PASS (virtual) |
| Preload in WebKit / contextBridge | production preload not executed; M0 OPEN | FAIL/NOT RUN |
| B5 repaired-primitive spike (test-only) | `m0-context-bridge`: checkpoint 1/2 PASS, decision go (macOS 26.5.2 / WebKit 21624.2.5.11.8; baseline CI) | PASS (test-only) |
| B6-A exposure authority (contract) | MoonBit exposure registry/dispatch, lifecycle/quotas; `context-bridge-exposure` 4 tests | PASS (contract; no transport) |
| B6-B preload bridge environment (experimental) | Opt-in `ELECTRON_MBT_B6_PRELOAD_BRIDGE=1`; unchanged oracle preload status ok, exposure event/MoonBit registration, reload revocation, no page API | PASS (experimental slice; no page API/transport) |
| B6-C synchronous transport (experimental) | Opt-in transport sources + document grant; unchanged oracle preload/page observation, reload/revocation, source hashes | PASS (experimental; strict blocked) |
| B6-D semantic matrix (experimental) | Value/error/callback/Promise/bounds/fault matrix; three transport defects fixed | PASS (experimental; limits open) |
| B6-E evidence packet | Baseline differential hook, CI evidence step, threat model/review checklist; project-owner acceptance for B7 design work | PREPARED + ACCEPTED (2026-10-18) for B7; strict admission gates open; baseline NOT RUN locally; external audit NOT RUN |
| B7 strict-profile admission | Plan, preload key/descriptor preview, pre-registered exposure before load, host expected-descriptor verification, admitted-descriptor page binding (bytes/function count/SHA-256 checked before materialize), actual-mismatch fail-closed tests, main-frame-only frame policy, page self-DoS test; strict-runtime gates | STARTED; experimental M1 admitted-descriptor binding closes same-key page materialization for deterministic preloads; dynamic/non-deterministic preloads fail closed; async host reply, Electron child frames, full fault matrix, strict nodeless port and independent review remain open; strict blocked |
| Production asset loading | Node-less snapshot-scoped `electron-mbt-app://` scheme; Node-backed supervisor still uses a loopback test server | PARTIAL (Node-less custom scheme; loopback test-only) |
| Timers/native promises/cancel | not supported by async bridge | NOT IMPLEMENTED |

## Aggregate evidence

- `verify-state`: 19/19 PASS, `NOT_READY`
- readiness: 34 checks, 27 PASS, 2 FAIL (`moji-preload-runtime`,
  `moji-m1-boot`), 5 NOT RUN
- `npm test`: 489 pass
- `moon test --target js`: 145 pass
- `moon test --target native`: 178 pass
- `node --test tests/nodeless-runtime.test.cjs`: 33 pass
- native supervisor/source snapshot/boot/renderer/dialog-ui probes: PASS

## Remaining scope

1. **M0 contextBridge gate**: the test-only B5 repaired-primitive spike
   recorded `go` on one macOS/WebKit build (checkpoint 1/2 PASS; Electron
   baseline differential CI-only). This is not production contextBridge:
   B6's page-admission ordering is closed for deterministic descriptors in the
   experimental M1 transport by the admitted-descriptor binding (2026-10-20),
   while non-deterministic preloads fail closed; arbitrary API keys, full
   preload globals/ipcRenderer/webUtils, frame policy and page self-DoS remain
   open. B6-A provides the exposure authority contract, B6-B the opt-in preload
   environment, B6-C an experimental transport E2E, B6-D the semantics matrix
   and B6-E the evidence/review packet accepted by the project owner for B7
   design work. The strict profile remains blocked pending the B7 runtime and
   security gates; M0 stays OPEN and the original preload stays NOT_EXECUTED.
2. **Production asset loading**: the Node-less runtime now serves the renderer
   from a staged snapshot over `electron-mbt-app://`; the Node-backed supervisor
   still uses a test-only loopback server.
3. **File/dialog depth**: session-scoped exact main user-file grants now work
   for panel/test selections; a main-realm `dialog.showOpenDialog` opens a real
   NSOpenPanel with test-injected read grants, and `dialog.showSaveDialog`
   opens a real NSSavePanel and grants test-injected exact-file readwrite
   access (new and existing targets, cancel, cap and denials covered).
   Grant persistence and revocation now work for the trusted main path
   ([docs/0054](0054-grant-persistence-and-revocation.md)); production
   directory consent, real file-selection human consent, human save
   selection/overwrite confirmation and sheet-modal parenting remain open.
   App-local main fs is host-backed, including partial directory/metadata
   `stat`/`readdir`/`mkdir`
   ([docs/0046](0046-nodeless-main-fs.md),
   [docs/0047](0047-nodeless-user-file-grants.md),
   [docs/0050](0050-nodeless-main-dialog.md),
   [docs/0051](0051-nodeless-main-save-dialog.md),
   [docs/0048](0048-nodeless-directory-fs.md)).
4. **Async depth**: timers/native completion promises, cancellation, deadlines.
5. **Export depth**: multi-page/print-accurate PDF/PNG, `assetBaseUrl`.
6. **Compatibility**: no verified rows; strict profile remains blocked.

This document is a checkpoint, not an acceptance of Electron compatibility.
