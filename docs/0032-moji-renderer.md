# Moji renderer boot (adapted profile)

Status: **PASS for a loopback renderer boot**. The pinned Moji renderer
(112 files, ~13 MB) loads in WKWebView under the adapted page API and renders
its real UI. The original preload is **NOT_EXECUTED**.

## Why a loopback asset server

The renderer is a Vite module build with `crossorigin` module scripts. Loading
it directly from `file://` in WKWebView does not execute the module graph
(file-origin module/CORS behavior). The probe therefore serves the **temporary
asset root** over a random `127.0.0.1` HTTP port and loads
`http://127.0.0.1:<port>/out/renderer/index.html`.

- server binds loopback only, serves only the temp root, rejects traversal and
  directory requests, and has no directory listing
- `load-url` is a **test-only** native operation restricted to
  `http://127.0.0.1:<port>` / `localhost`; it is not a production navigation
  surface
- the adapter observation and app ingress accept the exact loaded URL, not
  arbitrary HTTP frames
- the source snapshot still pins all 112 files; the HTTP server is only a
  delivery mechanism for the probe

The source-snapshot bounds were raised for this asset graph: 16 MiB per file,
64 MiB total, 4096 files (previously 1 MiB / 32 files).

## Evidence

`node scripts/m1-moji-renderer.cjs` → PASS:

```json
{"status":"PASS","probe":"moji-renderer-boot","pageLoaded":true,"apiPresent":true,"pageTitle":"Moji v1.0.5","rootChildren":1,"rendererLoaded":true,"preloadExecuted":false,"compatible":false}
```

The page text includes the real UI: `New`, `Open`, `Save`, `Preview`,
`Editor`, `Export`, `Moji v1.0.5`, `Open File`, `New File`. The renderer's
`getSettings`/`getUpdateState` calls reach the QuickJS Moji handlers
(`settingsTheme:"dark"`, `updateStatus:"unsupported"`).

The API probe also exercises the native file broker from the real renderer:

- `save('renderer-save.md', '# renderer save\n')` → `saveOk:true`
- `readPath('renderer-save.md')` → `readOk:true`, content
  `# renderer save\n`
- `readSample('markdown-guide.en.md')` → `sampleOk:true`, real sample content
  (`# Complete Markdown Guide...`)

The broker now returns the Moji-shaped `ok`/`content` fields (while retaining
`text` for the fixture probe) for `file:read-path`/`file:read-sample`;
`file:save` returns `ok`.

Open/save/export from the same renderer probe also pass with test-injected
paths: `openDialog` returns the sample document, `saveAs` writes a file,
`exportAs` writes HTML/PDF/PNG documents and `exportDiagramPng` writes PNG
(diagram). See
[docs/0033-moji-os-services.md](0033-moji-os-services.md).

The report's `apiProbe` is
`{"state":"done","saveOk":true,"readOk":true,"sampleOk":true,"settingsTheme":"dark"}`.
Report: [compatibility/reports/moji-renderer.json](compatibility/reports/moji-renderer.json).
Readiness rows `moji-renderer` and `node-less-moji-app-main` are PASS;
`adapted-moji-runtime` remains NOT_RUN because the original preload is not
executed and async file/dialog/export dispatch is incomplete.

## Deliberate limits

- the loopback HTTP server and `load-url` are **test-only**; production app
  loading is unresolved
- the original preload is NOT_EXECUTED; contextBridge/ipcRenderer is still the
  unresolved M0 gate
- the renderer's file/dialog/export calls are async; the bridge currently
  returns `ASYNC_PENDING` for them
- the file save/read uses a **test-only grant** for `renderer-save.md`; no
  human save dialog or production grant flow
- only the initial render and programmatic save/read/sample calls are asserted;
  no human UI interaction, dialog, export or update flow
- external Google Fonts may be unavailable; no visual/font acceptance
- no verified row; `compatible:false`, adapted **partial**, strict **blocked**
  unchanged

## Next

- add async handler dispatch and real dialog/export flows to the renderer
- exercise the real dialog UI and PDF/PNG document export
- move asset delivery out of the test-only loopback harness
- keep the original preload unexecuted until the contextBridge gate is resolved
