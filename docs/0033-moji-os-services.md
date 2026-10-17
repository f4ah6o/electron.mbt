# Moji renderer OS services (open/save/export)

Status: **PASS for test-injected paths**. The real Moji renderer calls
`openDialog`, `saveAs`, `exportAs` and `exportDiagramPng`; the native broker
grants/reads/writes the selected paths. The AppKit panel **UI is NOT RUN**.

## What works

- `openDialog()` → `{canceled:false, documents:[{path, content}]}` with the
  real `samples/markdown-guide.en.md` content.
- `saveAs('# save-as\n', 'save-as.md')` → writes the test-injected
  `renderer-save-as.md` and returns `{ok:true, path, bytes}`.
- `exportAs({format:'html', html, baseName})` → writes the test-injected
  `renderer-export.html`.
- `exportAs({format:'pdf', html, baseName})` → renders HTML in an offscreen
  WKWebView and writes a `%PDF` document to `renderer-export.pdf`.
- `exportAs({format:'png', html, baseName})` → snapshots the offscreen
  WKWebView and writes a PNG document to `renderer-export-doc.png`.
- `exportDiagramPng({dataUrl, baseName})` → writes the test-injected
  `renderer-export.png`.
- `save`, `readPath`, `readSample` and `getSettings` continue to work.
- `checkForUpdate()` awaits the async Moji handler and returns
  `{status:"unsupported"}`; see
  [docs/0034-async-main-dispatch.md](0034-async-main-dispatch.md).

The renderer API probe reports:

```json
{"state":"done","openOk":true,"saveAsOk":true,"exportOk":true,"pngOk":true,
 "pdfOk":true,"pdfLandscapeOk":true,"docPngOk":true,"saveOk":true,
 "readOk":true,"sampleOk":true,"settingsTheme":"dark","updateCheckOk":true}
```

The supervisor also fixes zero-argument broker calls from the adapter
(`{args:null}` is treated as no arguments), which is what `openDialog` sends.

## Evidence

`node scripts/m1-moji-renderer.cjs` → PASS. The report is
[compatibility/reports/moji-renderer.json](compatibility/reports/moji-renderer.json);
readiness `moji-renderer` requires `openOk`/`saveAsOk`/`exportOk`/`pngOk`/
`pdfOk`/`docPngOk`/`updateCheckOk` in addition to the earlier save/read/sample
checks.

## Deliberate limits

- all dialog/export paths are **test-injected** through `set-dialog-result`;
  a separate UI smoke opens and programmatically cancels the native
  `NSOpenPanel` (no selection/consent), see
  [docs/0036-dialog-ui-smoke.md](0036-dialog-ui-smoke.md)
- the open/save grant is test-only; no human consent flow
- `doc:export` supports HTML, PDF and PNG documents; PDF/PNG honor
  `pageSize` (A4/Letter/Legal) and `pageOrientation` (portrait/landscape)
  for the page rect; `assetBaseUrl` is ignored
- PDF/PNG document rendering uses an offscreen WKWebView/NSWindow; it is not a
  print-accurate or multi-page export path; page rects are fixed A4/Letter/Legal
- `exportDiagramPng` writes the supplied PNG bytes
- no human UI interaction beyond the programmatic probe
- the original preload remains **NOT_EXECUTED**
- no verified row; `compatible:false`, adapted **partial**, strict **blocked**
  unchanged

## Next

- exercise the real panel UI and record the environment
- implement PDF/PNG document rendering
- add async Main dispatch for remaining handlers
- replace test-injected grants with a production consent flow
