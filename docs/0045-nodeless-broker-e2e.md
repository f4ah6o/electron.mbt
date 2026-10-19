# Node-less broker E2E (test-injected)

Status: **partial broker E2E**. The Node-less runtime now applies a bounded,
explicit test scenario to the existing native file/dialog/export broker, triggers
the real Moji renderer's `window.api` file calls, and verifies the returned values
and written files. This is **not** production file consent: all paths are
test-injected and the runtime requires `--broker-selftest`.

## What runs

`nodeless-broker.json` is manifest-listed and applied only with
`--broker-selftest`:

```json
{
  "schema": 1,
  "grants": [{ "path": "renderer-save.md", "mode": "readwrite" }],
  "dialogs": [
    { "kind": "open", "path": "samples/markdown-guide.en.md" },
    { "kind": "save", "path": "renderer-save-as.md" },
    { "kind": "export-html", "path": "renderer-export.html" },
    { "kind": "export-png", "path": "renderer-export.png" },
    { "kind": "export-pdf", "path": "renderer-export.pdf" },
    { "kind": "export-doc-png", "path": "renderer-export-doc.png" }
  ]
}
```

The runtime calls `grant-file` / `set-dialog-result`, then the host's
`trigger-renderer-api` fixture. The real renderer's adapted page API performs:

- `openDialog()` against the injected open path and the real sample content;
- `save()` / `readPath()` against the granted path;
- `readSample()` against `samples/markdown-guide.en.md`;
- `saveAs()` against the injected save path;
- `exportAs({format:'html'|'pdf'|'png'})` against injected export paths;
- `exportDiagramPng()` against the injected diagram path;
- `setSettings({language:"ja"})` / `getSettings()` through the QuickJS main
  handlers, which persists `.appData/moji/settings.json`;
- `checkForUpdate()` through the QuickJS main handlers.

The runtime pumps `app-request` events while the probe is pending, so the final `setSettings`/`getSettings`/`checkForUpdate` calls settle, then
reports the page's `__mojiApiProbe`.

## Evidence

`node scripts/nodeless-moji-app.cjs` writes
[compatibility/reports/moji-nodeless-app.json](../compatibility/reports/moji-nodeless-app.json).
Observed broker fields:

```json
{
  "configured": true,
  "mode": "test-injected",
  "grants": 1,
  "dialogs": 6,
  "triggered": true,
  "error": "",
  "apiProbe": {
    "state": "done",
    "openOk": true,
    "saveAsOk": true,
    "exportOk": true,
    "pngOk": true,
    "pdfOk": true,
    "pdfLandscapeOk": true,
    "docPngOk": true,
    "saveOk": true,
    "readOk": true,
    "sampleOk": true,
    "updateCheckOk": true,
    "settingsTheme": "dark",
    "settingsSetOk": true,
    "settingsLanguage": "ja"
  }
}
```

The harness also verifies the written outputs before deleting the temp app:

| file | check |
| --- | --- |
| `renderer-save.md` | exact `# renderer save\n` |
| `renderer-save-as.md` | exact `# save-as\n` |
| `renderer-export.html` | contains `<h1>renderer export</h1>` |
| `renderer-export.pdf` | `%PDF` prefix |
| `renderer-export.png` | PNG magic |
| `renderer-export-doc.png` | PNG magic |
| `.appData/moji/settings.json` | `language === "ja"` (`settingsPersisted:true`) |

## Security boundary

- `--broker-selftest` is required; a manifest-listed `nodeless-broker.json` is
  ignored without it. A negative test runs a window app with a broker file but
  no flag and observes `broker.configured:false`.
- Grants and dialog paths are resolved by the host through `canonicalAppPath`
  and remain confined to the app root for this broker scenario. Main-side fs
  writes are confined to `.appData`/`.userData` plus exact write grants; main
  reads are confined to the app root plus session-scoped exact user-file grants.
  Grant persistence and human panel consent remain unimplemented
  ([user-file grants](0047-nodeless-user-file-grants.md)).
- `grant-file` / `set-dialog-result` are test controls, not a production consent
  API. No human selection, save-panel consent, grant persistence or real
  `NSOpenPanel`/`NSSavePanel` interaction is exercised by this report.
- The trigger is a host fixture that calls the adapted `window.api`; it is not an
  application IPC surface and does not execute the original preload.

## Limits

- test-injected paths only; production grants and dialogs **NOT IMPLEMENTED**
- the native open/save panel UI and human consent are **NOT RUN** here (the
  separate adapted dialog smoke covers open/cancel only)
- PDF/PNG exports are not print-accurate or multi-page, and `assetBaseUrl` is
  ignored
- main-side user grants are session-scoped and exact-file only; persistence,
  human consent, directory/stream APIs and true async fs remain unimplemented
- updater behavior is the import-only `unsupported` stub
- original preload/contextBridge, strict profile, ASAN, ownership review and
  external audit remain open
- `compatible:false`; no compatibility row

## Verification

| command | result |
| --- | --- |
| `node scripts/nodeless-moji-app.cjs` | PASS (broker test-injected) |
| `node --test tests/nodeless-runtime.test.cjs` | 16 PASS |
| `node scripts/preview-readiness.cjs` | NOT_READY (33 checks; expected exit 2) |
| `npm test` | 471 PASS |
| `moon test --target native` | 177 PASS |
| `moon test --target js` | 145 PASS |
| ASAN / ownership review / external audit | NOT RUN |
