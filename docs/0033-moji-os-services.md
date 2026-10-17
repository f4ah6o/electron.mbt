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
- `exportDiagramPng({dataUrl, baseName})` → writes the test-injected
  `renderer-export.png`.
- `save`, `readPath`, `readSample` and `getSettings` continue to work.

The renderer API probe reports:

```json
{"state":"done","openOk":true,"saveAsOk":true,"exportOk":true,"pngOk":true,
 "saveOk":true,"readOk":true,"sampleOk":true,"settingsTheme":"dark"}
```

The supervisor also fixes zero-argument broker calls from the adapter
(`{args:null}` is treated as no arguments), which is what `openDialog` sends.

## Evidence

`node scripts/m1-moji-renderer.cjs` → PASS. The report is
[compatibility/reports/moji-renderer.json](compatibility/reports/moji-renderer.json);
readiness `moji-renderer` requires `openOk`/`saveAsOk`/`exportOk`/`pngOk` in
addition to the earlier save/read/sample checks.

## Deliberate limits

- all dialog/export paths are **test-injected** through `set-dialog-result`;
  `NSOpenPanel`/`NSSavePanel` UI is compiled but not exercised
- the open/save grant is test-only; no human consent flow
- `doc:export` supports HTML only; PDF/PNG document rendering remains
  unimplemented; `exportDiagramPng` writes the supplied PNG bytes
- no human UI interaction beyond the programmatic probe
- the original preload remains **NOT_EXECUTED**
- no verified row; `compatible:false`, adapted **partial**, strict **blocked**
  unchanged

## Next

- exercise the real panel UI and record the environment
- implement PDF/PNG document rendering
- add async Main dispatch for remaining handlers
- replace test-injected grants with a production consent flow
